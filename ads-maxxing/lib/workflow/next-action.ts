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
  const variant = session.variants.find(item => item.id === intent.briefId);
  if (variant) {
    if (variant.status === "pending_review") return { ...base, kind: intent.pausedReason === "failure" ? "retry" : "continue", message: "Your ad is saved. Finish its review." };
    return { ...base, kind: "complete", variantId: variant.id, message: variant.status === "review_failed" ? "Your ad is saved. Its automated review was unavailable." : "Your ad is ready to review." };
  }
  const brief = session.brief?.id === intent.briefId ? session.brief : undefined;
  const uncertain = [brief?.backgroundCheckpoint, brief?.sceneCheckpoint].find(item => item?.state === "attempted" && !item.provider);
  if (uncertain) return { ...base, kind: "retry", briefId: brief!.id, duplicateRisk: uncertain.failure?.outcome !== "rejected", message: uncertain.failure?.outcome === "rejected" ? "The image provider rejected this attempt. Retry starts a new paid attempt and keeps saved stages." : "The previous image request may have completed, but no result was saved. Starting another attempt may charge twice." };
  if (intent.pausedReason === "failure") return { ...base, kind: "retry", message: intent.error || "Saved work is retained. Try this step again." };
  if (intent.researchId && (session.researchState?.stage === "needs_selection" || intent.pausedReason === "needs_input")) return { ...base, kind: "needs_input", message: intent.error || "Choose a product or confirm its photo to continue." };
  return { ...base, kind: "continue", message: brief ? "Finishing your saved creative." : intent.researchId ? "Preparing your creative." : "Researching your campaign." };
}
