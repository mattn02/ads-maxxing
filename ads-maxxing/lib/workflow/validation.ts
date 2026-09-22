import { InvalidToolInputError, NoObjectGeneratedError } from "ai";
import { ZodError } from "zod";

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
  return Response.json({ error: safeError(error) }, { status: 502 });
}
export function safeError(error: unknown): string {
  if (error instanceof WorkflowError) return error.message;
  if (InvalidToolInputError.isInstance(error)) return `Invalid input for ${error.toolName}. Supply a valid URL and leave optional URLs blank or null. The tool did not run.`;
  if (error instanceof ZodError) return `Invalid input: ${error.issues.map(issue => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ")}`;
  if (NoObjectGeneratedError.isInstance(error)) return "The model did not return valid structured data. Try the request again; no automatic retry was made.";
  if (error instanceof Error && /AI Gateway requires a valid credit card/i.test(error.message)) {
    return "Vercel AI Gateway requires a credit card on file. Enable billing in your Vercel AI Gateway settings before retrying. Saved work is retained; no automatic retry was made.";
  }
  if (error instanceof Error && /Free tier users do not have access to this model/i.test(error.message)) {
    return "The configured Gateway model is unavailable on the free tier. Use inclusionai/ling-3.0-flash-vl-free, or remove the role-specific MODEL override and restart the dev server.";
  }
  return "Provider request failed or timed out. Check credentials, credits and connectivity. Saved work is retained; no automatic retry was made.";
}
export function requireKey(name: "FIRECRAWL_API_KEY" | "FAL_AI_API_KEY") {
  const key = process.env[name];
  if (!key) throw new WorkflowError(`Set ${name} in .env.local, then restart the dev server.`, 503);
  return key;
}
