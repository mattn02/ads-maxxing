import { research } from "./agents/researcher";
import { saveSession } from "./sessions";
import type { Session } from "./session-types";
import { safeError, WorkflowError } from "./validation";
import { stableId } from "./research/extract";

/** The route owns the lease and awaits the entire operation. Mounting never invokes this. */
export async function researchBrand(
  session: Session,
  operationId: string,
  deps = { research, save: saveSession },
) {
  if (session.purpose !== "brand_setup" || !session.setup)
    throw new WorkflowError("Open brand setup to research a brand.", 409);
  if (
    session.setup.state === "ready" ||
    session.setup.operationId === operationId
  )
    return session;
  session.setup = {
    ...session.setup,
    state: "researching",
    progress: "reading",
    operationId,
    startedAt: new Date().toISOString(),
    error: undefined,
    completedAt: undefined,
  };
  await deps.save(session);
  try {
    const result = await deps.research(
      { url: session.setup.storeUrl, productUrl: null, campaignUrl: null },
      {
        scope: "brand",
        progress: async (event) => {
          if (event.action === "research:synthesis")
            session.setup!.progress = "understanding";
          session.events.push({ ...event, at: new Date().toISOString() });
          await deps.save(session);
        },
        checkpoint: async (partial) => {
          session.research = partial;
          await deps.save(session);
        },
      },
    );
    if (!result.sources.length || !result.brandKit)
      throw new WorkflowError(
        "No usable store source was retrieved. Edit the URL or retry.",
        502,
      );
    const original = session.setup.originalUrl;
    if (original && new URL(original).pathname !== "/") {
      result.suggestions = [
        {
          id: stableId("choice", original),
          label: "Start with the page you shared",
          url: original,
          origin: "user_supplied" as const,
          reason: "You shared this page. Choose it to research what it offers.",
        },
        ...(result.suggestions || []).filter((item) => item.url !== original),
      ].slice(0, 3);
    }
    session.research = result;
    session.setup.progress = "saving";
    await deps.save(session);
    session.setup.state = "ready";
    session.setup.completedAt = new Date().toISOString();
    session.researchState = { stage: "awaiting_direction" };
    await deps.save(session);
  } catch (error) {
    session.setup.state = "failed";
    session.setup.error = safeError(error);
    // Give a failed operation a durable recovery state; keep any observed checkpoint.
    await deps.save(session);
    throw error;
  }
  return session;
}
