import { authenticated, persistenceContext, ownerContext } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";
import { createAgentUIStreamResponse } from "ai";
import { z } from "zod";
import { createConcierge } from "@/lib/workflow/agents/concierge";
import { mergeVariantTurn, messagesForVariant, tagMessageForVariant } from "@/lib/workflow/chat-scope";
import { conciergeText } from "@/lib/workflow/concierge-stream";
import { Workflow } from "@/lib/workflow/service";
import { loadSession, lockSession, saveSession } from "@/lib/workflow/sessions";
import { apiError, safeError, WorkflowError } from "@/lib/workflow/validation";
export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.object({
  id: z.string(),
  variantId: z.string().min(1),
  message: z.object({ id: z.string().min(1).max(100), role: z.literal("user"), parts: z.array(z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(8000) })).min(1).max(1) }),
});
export async function POST(request: Request) {
  return authenticated(request, async () => {
  let release: (() => Promise<void>) | undefined;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) throw new WorkflowError("Send a session ID and a text-only user message.");
    const { id, variantId, message } = parsed.data;
    release = await lockSession(id);
    const session = await loadSession(id);
    if (session.purpose !== "campaign" || !session.research?.brandKit) throw new WorkflowError("Finish brand setup and choose Make creatives first.", 409);
    const target = session.variants.find(variant => variant.id === variantId && !!variant.imageUrl);
    if (!target) throw new WorkflowError("That ad is no longer available. Refresh your workspace.", 409);
    // The server owns history. Clients cannot inject assistant messages or approval state.
    if (session.messages.some(item => item.id === message.id)) throw new WorkflowError("This message was already submitted. Reload the session before trying again.", 409);
    const workflow = new Workflow(session);
    workflow.setUserInput(message.parts[0].text, message.id);
    const agent = createConcierge(workflow, undefined, target);
    delete session.lastError;
    session.messages.push(tagMessageForVariant(message, variantId));
    await saveSession(session);
    // The stored campaign still contains every conversation. Only this ad's turns reach the model.
    const history = messagesForVariant(session.messages, variantId).slice(-12);
    const unlock = release;
    const context = ownerContext();
    return await createAgentUIStreamResponse({
      agent, uiMessages: history, timeout: 300000, generateMessageId: randomUUID, sendReasoning: false,
      messageMetadata: () => ({ variantId }),
      experimental_transform: conciergeText(agent.responseText),
      onError: error => {
        const detail = safeError(error);
        if (session.lastError === detail) return detail;
        session.lastError = detail;
        session.events.push({ at: new Date().toISOString(), action: "chat", status: "failed", detail });
        return detail;
      },
      onEnd: async ({ messages }) => persistenceContext.run(context, async () => {
        await agent.waitForTools();
        session.messages = mergeVariantTurn(session.messages, history, messages, variantId);
        await saveSession(session);
      }),
      // Finish saving even if a browser disconnects; never start another paid request.
      consumeSseStream: async ({ stream }) => {
        const reader = stream.getReader();
        try { while (!(await reader.read()).done) { /* consume to completion */ } }
        finally { reader.releaseLock(); await unlock(); }
      },
    });
  } catch (error) { await release?.(); return apiError(error); }
  });
}
