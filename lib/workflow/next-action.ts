import type { NextAction } from "./generation-contracts";
import type { Session } from "./session-types";

export function campaignNextAction(session: Session): NextAction | undefined {
  const intent = session.researchState?.generationIntent;
  if (!intent) return;
  const base = { requestId: intent.requestId };
  const leaseActive = !!session.leaseExpiresAt && Date.parse(session.leaseExpiresAt) > Date.now();
  if (!intent.researchId && !leaseActive && session.events?.some(event => event.action === "research" && event.status === "started" && Date.parse(event.at) >= Date.parse(intent.authorizedAt))) {
    return { ...base, kind: "retry", message: "Research started, but its final checkpoint was not saved. Saved findings are retained. Retry this step explicitly to continue." };
  }
  if (intent.setupPending && intent.researchId && intent.pausedReason !== "failure") return { ...base, kind: "needs_input", message: intent.error || "Choose a product photo and optional offer to make this ad." };
  const variant = session.variants.find(item => item.id === intent.briefId);
  if (variant) {
    if (variant.status === "pending_review") return { ...base, kind: intent.pausedReason === "failure" ? "retry" : "continue", message: "Your ad is saved. Finish its review." };
    return { ...base, kind: "complete", variantId: variant.id, message: variant.status === "review_failed" ? "Your ad is ready. Automated feedback was unavailable, so review it directly." : "Your ad and automated feedback are ready for your decision." };
  }
  const brief = session.brief?.id === intent.briefId ? session.brief : undefined;
  const uncertain = brief?.sceneCheckpoint?.state === "attempted" && !brief.sceneCheckpoint.provider ? brief.sceneCheckpoint : undefined;
  if (uncertain) return { ...base, kind: "retry", briefId: brief!.id, duplicateRisk: uncertain.failure?.outcome !== "rejected", message: uncertain.failure?.outcome === "rejected" ? "The image provider rejected this attempt. Retry starts a new paid scene attempt." : "The previous image request may have completed, but no result was saved. Starting another attempt may charge twice." };
  if (intent.pausedReason === "failure") return { ...base, kind: "retry", message: intent.error || "Saved work is retained. Try this step again." };
  if (intent.researchId && (session.researchState?.stage === "needs_selection" || intent.pausedReason === "needs_input")) return { ...base, kind: "needs_input", message: intent.error || "Choose a product with a Shopify-associated photo to continue." };
  return { ...base, kind: "continue", message: brief ? "Finishing your saved creative." : intent.researchId ? "Preparing your creative." : "Researching your campaign." };
}
