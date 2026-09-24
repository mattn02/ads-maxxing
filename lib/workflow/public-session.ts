import type { Session } from "./session-types";
import { campaignNextAction } from "./next-action";
import { normalizeResearchOffers } from "./research/offer-copy";
/** Recovery URLs are server-only; clients steer content, never provider recovery metadata. */
export function publicSession(session: Session): Session {
  const projected: Session = JSON.parse(JSON.stringify({ ...session, nextAction: campaignNextAction(session), operationActive: !!session.leaseExpiresAt && Date.parse(session.leaseExpiresAt) > Date.now() }, (key,value) => key === "provider" || key === "providerOutputUrl" || key === "providerImageUrl" ? undefined : value));
  // Older immutable snapshots may contain Markdown in their display fields.
  // Clean the client projection without rewriting saved research or finished ads.
  if (projected.research) projected.research = normalizeResearchOffers(projected.research);
  for (const variant of projected.variants ?? []) {
    if (variant.research) variant.research = normalizeResearchOffers(variant.research);
  }
  return projected;
}
