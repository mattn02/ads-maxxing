import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Research, Session, Variant } from "./session-types";
import { WorkflowError } from "./validation";
import { normalizeMessages } from "./messages";
import { ownerContext, rows, rpc } from "../supabase/server";

/** Used only by the explicit legacy importer and developer fixtures. */
export const dataDirectory = () => process.env.WORKFLOW_DATA_DIR || path.join(process.cwd(), "local-output");
export function sessionId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new WorkflowError("Invalid session ID.");
  return id;
}
export function normalizedHostname(url: string) { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
export { parseResearchSnapshot as parseSnapshot } from "./research/persistence-schema";
import { parseResearchSnapshot as parseSnapshot } from "./research/persistence-schema";
type Campaign = { id: string; brand_id: string | null; name: string; created_at: string; updated_at: string; current_research_id: string | null; current_version_id: string | null; preferences: Session["preferences"]; messages: Session["messages"]; events: Session["events"]; last_error: string | null; workflow_state: unknown };
export async function saveSession(session: Session) {
  const context = ownerContext();
  if (!context.lease || context.lease.campaignId !== session.id) throw new WorkflowError("A live campaign lease is required to save.", 409);
  session.messages = normalizeMessages(session.messages);
  const research = session.research;
  const version = (research as (Research & { schemaVersion?: number }) | undefined)?.schemaVersion ?? 1;
  if (research) parseSnapshot(research, version);
  const result = await rpc<{ revision: number; brand_id: string | null }>("commit_campaign", { p_owner: context.userId, p_id: session.id, p_token: context.lease.token, p_revision: context.lease.revision, p_session: session, p_hostname: research ? normalizedHostname((research as Research & {brandKit?:{canonicalStoreUrl?:string}}).brandKit?.canonicalStoreUrl || research.sources[0].url) : null, p_schema_version: version });
  context.lease.revision = result.revision;
  context.brandId = result.brand_id ?? undefined;
}
export async function createSession(): Promise<Session> {
  const id = randomUUID();
  await rpc("create_campaign", { p_owner: ownerContext().userId, p_id: id });
  return loadSession(id);
}
export async function loadSession(id: string): Promise<Session> {
  const [campaign] = await rows<Campaign>("campaigns", `id=eq.${sessionId(id)}&select=*`);
  if (!campaign) throw new WorkflowError("Session not found.", 404);
  const versions = await rows<{ id: string; brief: Session["brief"]; generation: Variant | null; research_snapshot_id: string }>("ad_versions", `campaign_id=eq.${id}&select=id,brief,generation,research_snapshot_id&order=created_at.asc`);
  const ids = [...new Set([campaign.current_research_id, ...versions.map(v => v.research_snapshot_id)].filter(Boolean))];
  const snapshots = ids.length ? await rows<{ id: string; schema_version: number; data: unknown }>("research_snapshots", `id=in.(${ids.join(",")})&select=id,schema_version,data`) : [];
  const research = new Map(snapshots.map(row => [row.id, parseSnapshot(row.data, row.schema_version)]));
  ownerContext().brandId = campaign.brand_id ?? undefined;
  return { id, createdAt: campaign.created_at, updatedAt: campaign.updated_at, messages: normalizeMessages(campaign.messages), preferences: campaign.preferences, events: campaign.events, ...(campaign.last_error ? { lastError: campaign.last_error } : {}), ...(campaign.workflow_state ? { researchState: campaign.workflow_state } : {}), research: research.get(campaign.current_research_id ?? ""), brief: versions.find(row => row.id === campaign.current_version_id)?.brief, variants: versions.filter(row => row.generation).map(row => ({ ...row.generation!, brief: row.brief!, research: research.get(row.research_snapshot_id)! })) };
}
export async function listSessions() {
  return (await rows<Pick<Campaign, "id" | "updated_at" | "name">>("campaigns", "status=eq.active&select=id,updated_at,name&order=updated_at.desc")).map(row => ({ id: row.id, updatedAt: row.updated_at, title: row.name }));
}
export async function lockSession(id: string) {
  const context = ownerContext();
  const claim = await rpc<{ token: string; revision: number }>("claim_campaign", { p_owner: context.userId, p_id: sessionId(id) });
  context.lease = { campaignId: id, ...claim };
  return async () => { await rpc("release_campaign", { p_owner: context.userId, p_id: id, p_token: claim.token }); if (context.lease?.token === claim.token) delete context.lease; };
}
