import type { Session } from "./session-types";
/** Recovery URLs are server-only; clients steer content, never provider recovery metadata. */
export function publicSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session, (key,value) => key === "provider" || key === "providerOutputUrl" || key === "providerImageUrl" ? undefined : value));
}
