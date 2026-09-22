import { authenticated } from "@/lib/supabase/server";
import { publicSession } from "@/lib/workflow/public-session";
import { z } from "zod";
import { briefSchema } from "@/lib/workflow/schema";
import { Workflow } from "@/lib/workflow/service";
import { loadSession, lockSession } from "@/lib/workflow/sessions";
import { apiError, WorkflowError } from "@/lib/workflow/validation";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approveBrief"), briefId: z.string() }),
  z.object({ action: z.literal("generateAd"), briefId: z.string().min(1) }),
  z.object({ action: z.literal("reviseBrief"), brief: briefSchema }),
  z.object({ action: z.literal("approveAd"), variantId: z.string() }),
  z.object({ action: z.literal("reviewAd"), variantId: z.string() }),
]);
export async function GET(_request: Request, { params }: Context) {
  return authenticated(_request, async () => Response.json(publicSession(await loadSession((await params).id))));
}
export async function POST(request: Request, { params }: Context) {
  return authenticated(request, async () => {
  let release: (() => Promise<void>) | undefined;
  try {
    const { id } = await params;
    release = await lockSession(id);
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new WorkflowError("Invalid workflow action or brief.");
    const workflow = new Workflow(await loadSession(id));
    const action = parsed.data;
    switch (action.action) {
      case "approveBrief": await workflow.approveBrief(action.briefId); break;
      case "generateAd": await workflow.generate(action.briefId); break;
      case "reviseBrief": await workflow.proposeBrief(action.brief); break;
      case "approveAd": await workflow.approveVariant(action.variantId); break;
      case "reviewAd": await workflow.review(action.variantId); break;
    }
    return Response.json(publicSession(workflow.session));
  } catch (error) { return apiError(error); }
  finally { await release?.(); }
  });
}
