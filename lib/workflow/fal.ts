import { requireKey, WorkflowError } from "./validation";
import { MODEL, SCENE_SETTINGS } from "./fal-model";
import type { ProviderResult } from "./creative/schema";
export { MODEL } from "./fal-model";
export class ImageRequestError extends WorkflowError {
  constructor(message: string, public readonly outcome: "rejected" | "unknown", status = 502) { super(message, status); }
}
export function assertImageConfiguration() { requireKey("FAL_AI_API_KEY"); }
async function request(model: string, sourceImage: string, prompt: string): Promise<ProviderResult> {
  const key = requireKey("FAL_AI_API_KEY");
  const response = await fetch(`https://fal.run/${model}`, {
    method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...SCENE_SETTINGS, prompt, image_urls: [sourceImage] }),
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = typeof failure.detail === "string" ? failure.detail : typeof failure.message === "string" ? failure.message : "";
    const reason = /balance|credit|exhausted/i.test(detail) ? "Your fal account needs credits." : response.status === 401 || response.status === 403 ? "Check fal key permissions and model access." : "Inspect this saved attempt before approving a new revision.";
    throw new ImageRequestError(`fal returned HTTP ${response.status}. ${reason}`, [400, 401, 403, 422, 429].includes(response.status) ? "rejected" : "unknown");
  }
  const result = await response.json();
  if (result.has_nsfw_concepts?.some(Boolean)) throw new WorkflowError("fal flagged this output. Save a new brief with a different scene direction.", 422);
  const imageUrl = result.images?.[0]?.url;
  if (typeof imageUrl !== "string") throw new WorkflowError("fal returned no image. Inspect the attempted stage before creating another revision.", 502);
  return { imageUrl, model, ...(typeof result.seed === "number" ? { seed: result.seed } : {}), ...(response.headers.get("x-fal-request-id") ? { requestId: response.headers.get("x-fal-request-id")! } : {}) };
}
/** The immutable Shopify product photo is the only visual reference. */
export function generateScene(sourceImage: string, prompt: string) {
  if (!sourceImage) throw new WorkflowError("Scene generation needs the saved original product photo.");
  return request(MODEL, sourceImage, prompt);
}
