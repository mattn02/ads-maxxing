export class WorkflowError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function text(value: unknown, label: string, max = 8000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new WorkflowError(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function webUrl(value: unknown): string {
  const input = text(value, "URL", 4000);
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new WorkflowError("Enter a valid http:// or https:// URL."); }
}
export function apiError(error: unknown) {
  if (error instanceof WorkflowError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  // Never return provider payloads or errors that might contain credentials.
  return Response.json({ error: "The request failed or timed out. Check connectivity and try again. A timed-out generation may still be billed by fal." }, { status: 502 });
}
export function requireKey(name: "FIRECRAWL_API_KEY" | "FAL_AI_API_KEY") {
  const key = process.env[name];
  if (!key) throw new WorkflowError(`Set ${name} in .env.local, then restart the dev server.`, 503);
  return key;
}
