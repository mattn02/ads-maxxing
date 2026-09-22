import { AsyncLocalStorage } from "node:async_hooks";
import { WorkflowError, apiError } from "../workflow/validation";

export type PersistenceContext = { userId: string; lease?: { campaignId: string; token: string; revision: number }; brandId?: string };
export const persistenceContext = new AsyncLocalStorage<PersistenceContext>();
export function ownerContext() {
  const context = persistenceContext.getStore();
  if (!context) throw new WorkflowError("Authenticated workflow context is required.", 401);
  return context;
}
export function configuration() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !serviceKey) throw new WorkflowError("Configure SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then apply the Supabase migration. Local persistence is disabled.", 503);
  return { url: url.replace(/\/$/, ""), key, serviceKey };
}
export async function supabase(path: string, init: RequestInit = {}, token?: string) {
  const config = configuration();
  const response = await fetch(`${config.url}${path}`, { ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(30000), headers: { apikey: token ? config.key : config.serviceKey, ...(token || config.serviceKey.startsWith("eyJ") ? { Authorization: `Bearer ${token ?? config.serviceKey}` } : {}), "Content-Type": "application/json", ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message : "";
    if (message.startsWith("WORKFLOW:")) throw new WorkflowError(message.slice(9), 409);
    throw new WorkflowError(`Supabase operation failed (${response.status}). Check configuration and migrations; saved work is retained.`, response.status === 404 ? 404 : 503);
  }
  return response;
}
export async function rpc<T>(name: string, payload: object): Promise<T> {
  const response = await supabase(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(payload) });
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}
export async function rows<T>(table: string, query: string): Promise<T[]> {
  return (await supabase(`/rest/v1/${table}?user_id=eq.${ownerContext().userId}&${query}`)).json();
}
function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}
/** Next may construct request.url with its internal listening hostname.
 * Match the browser authority against Host; never let x-forwarded-host override it.
 * Deployment proxies must preserve Host and supply a single forwarded protocol.
 */
function sameOrigin(request: Request, origin: string): boolean {
  try {
    if (!/^https?:\/\/[^/?#\\]+$/i.test(origin)) return false;
    const supplied = new URL(origin);
    if (supplied.username || supplied.password) return false;
    const internal = new URL(request.url);
    const host = request.headers.get("host") ?? internal.host;
    if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])(?::[0-9]+)?$/i.test(host)) return false;
    const protocol = request.headers.get("x-forwarded-proto") ?? internal.protocol.slice(0, -1);
    if (protocol !== "http" && protocol !== "https") return false;
    return supplied.origin === new URL(`${protocol}://${host}`).origin;
  } catch { return false; }
}
/** Verify every caller with Auth. The user ID never comes from a request body or JWT decoding. */
export async function authenticated(request: Request, work: () => Promise<Response>, allowNew = false): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && !sameOrigin(request, origin)) throw new WorkflowError("Cross-origin mutation rejected.", 403);
    const config = configuration();
    let access = cookie(request, "creative-access");
    const refresh = cookie(request, "creative-refresh");
    let identity: { id: string } | undefined;
    let tokens: { access_token: string; refresh_token: string; expires_in: number } | undefined;
    if (access) {
      const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.key, Authorization: `Bearer ${access}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.ok) identity = await response.json();
      else if (response.status >= 500) throw new WorkflowError("Identity verification is temporarily unavailable.", 503);
    }
    if (!identity && (refresh || allowNew)) {
      const response = await fetch(`${config.url}/auth/v1/${refresh ? "token?grant_type=refresh_token" : "signup"}`, { method: "POST", headers: { apikey: config.key, "Content-Type": "application/json" }, body: JSON.stringify(refresh ? { refresh_token: refresh } : {}), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new WorkflowError("Unable to restore your identity. Enable Supabase anonymous sign-in or sign in again; no new identity replaced your saved session.", 401);
      const result = await response.json();
      tokens = result;
      access = result.access_token;
      // Re-verify issued identity through Auth rather than trusting local cookie state.
      identity = await (await supabase("/auth/v1/user", {}, access)).json();
    }
    if (!identity?.id) throw new WorkflowError("Open the workspace to establish your private demo session.", 401);
    const response = await persistenceContext.run({ userId: identity.id }, work);
    response.headers.set("Cache-Control", "no-store");
    if (tokens) {
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      response.headers.append("Set-Cookie", `creative-access=${tokens.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${tokens.expires_in}${secure}`);
      response.headers.append("Set-Cookie", `creative-refresh=${tokens.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    }
    return response;
  } catch (error) { return apiError(error); }
}
