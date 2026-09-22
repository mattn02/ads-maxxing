import type { Session } from "./session-types";
import { campaignNextAction } from "./next-action";
/** Recovery URLs are server-only; clients steer content, never provider recovery metadata. */
export function publicSession(session: Session): Session {
  return JSON.parse(JSON.stringify({ ...session, nextAction: campaignNextAction(session), operationActive: !!session.leaseExpiresAt && Date.parse(session.leaseExpiresAt) > Date.now() }, (key,value) => key === "provider" || key === "providerOutputUrl" || key === "providerImageUrl" ? undefined : value));
}
