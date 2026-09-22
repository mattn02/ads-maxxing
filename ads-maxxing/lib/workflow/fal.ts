import { requireKey, WorkflowError } from "./validation";
import { MODEL, BACKGROUND_MODEL, IMAGE_SETTINGS, SCENE_SETTINGS } from "./fal-model";
import type { ProviderResult } from "./creative/schema";
export { MODEL, BACKGROUND_MODEL } from "./fal-model";
async function request(model: string, prompt: string, images?: string[]): Promise<ProviderResult> {
  const key = requireKey("FAL_AI_API_KEY");
  const response = await fetch(`https://fal.run/${model}`, {
    method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...(images ? SCENE_SETTINGS : IMAGE_SETTINGS), prompt, ...(images ? { image_urls: images } : {}) }),
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = typeof failure.detail === "string" ? failure.detail : typeof failure.message === "string" ? failure.message : "";
    const reason = /balance|credit|exhausted/i.test(detail) ? "Your fal account needs credits." : response.status === 401 || response.status === 403 ? "Check fal key permissions and model access." : "Inspect this saved attempt before approving a new revision.";
    throw new WorkflowError(`fal returned HTTP ${response.status}. ${reason}`, 502);
  }
  const result = await response.json();
  if (result.has_nsfw_concepts?.some(Boolean)) throw new WorkflowError("fal flagged this output. Save a new brief with a different scene direction.", 422);
  const imageUrl = result.images?.[0]?.url;
  if (typeof imageUrl !== "string") throw new WorkflowError("fal returned no image. Inspect the attempted stage before creating another revision.", 502);
  return { imageUrl, model, ...(typeof result.seed === "number" ? { seed: result.seed } : {}), ...(response.headers.get("x-fal-request-id") ? { requestId: response.headers.get("x-fal-request-id")! } : {}) };
}
export function generateBackground(prompt: string) { return request(BACKGROUND_MODEL, prompt); }
/** Both references are mandatory, with immutable product identity always first. */
export function generateScene(sourceImage: string, backgroundImage: string, prompt: string) {
  if (!sourceImage || !backgroundImage) throw new WorkflowError("Scene generation needs the saved original and background.");
  return request(MODEL, prompt, [sourceImage, backgroundImage]);
}
