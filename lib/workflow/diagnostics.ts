import { randomUUID } from "node:crypto";
import { safeError, WorkflowError } from "./validation";

export type Progress = { action: string; status: "started" | "completed" | "failed"; detail: string };
export type ReportProgress = (event: Progress) => Promise<void>;

function errorMetadata(error: unknown) {
  const chain: { name?: string; code?: string; status?: number }[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error) && chain.length < 8) {
    seen.add(error);
    const value = error as { name?: unknown; code?: unknown; statusCode?: unknown; cause?: unknown };
    const identifier = (item: unknown) => typeof item === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(item) ? item : undefined;
    chain.push({ name: identifier(value.name), code: identifier(value.code), status: typeof value.statusCode === "number" ? value.statusCode : undefined });
    error = value.cause;
  }
  return chain;
}

/** Log only allowlisted metadata, never prompts, response bodies, or credentials. */
export async function observed<T>(stage: string, label: string, work: () => Promise<T>, report?: ReportProgress, options?: { optional: boolean }): Promise<T> {
  const id = randomUUID();
  const started = Date.now();
  const emit = async (event: Progress) => {
    try { await report?.(event); }
    catch (error) { console.error(JSON.stringify({ event: "research-progress-save", id, stage, detail: safeError(error) })); }
  };
  await emit({ action: `research:${stage}`, status: "started", detail: label });
  try {
    const result = await work();
    const detail = `${label} · ${((Date.now() - started) / 1000).toFixed(1)}s`;
    console.info(JSON.stringify({ event: "research", id, stage, status: "completed", durationMs: Date.now() - started }));
    await emit({ action: `research:${stage}`, status: "completed", detail });
    return result;
  } catch (error) {
    const detail = `${label}: ${options?.optional ? "Optional check unavailable; continuing with saved findings. " : ""}${safeError(error)} (reference ${id})`;
    console.error(JSON.stringify({ event: "research", id, stage, status: "failed", durationMs: Date.now() - started, detail, causes: errorMetadata(error) }));
    await emit({ action: `research:${stage}`, status: options?.optional ? "completed" : "failed", detail });
    throw new WorkflowError(detail, error instanceof WorkflowError ? error.status : 502);
  }
}
