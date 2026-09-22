import { requireKey, WorkflowError } from "./validation";
export const MODEL = "fal-ai/flux-2/klein/4b/edit";
// One reference, one image, four steps. Keep model-specific arguments here.
export async function generateImage(referenceImage: string, prompt: string) {
  const key = requireKey("FAL_AI_API_KEY");
  const response = await fetch(`https://fal.run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_urls: [referenceImage], prompt, image_size: { width: 576, height: 1024 }, num_images: 1, num_inference_steps: 4, output_format: "png", enable_safety_checker: true }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = typeof failure.detail === "string" ? failure.detail : typeof failure.message === "string" ? failure.message : "";
    const reason = /balance|credit|exhausted/i.test(detail) ? "Your fal account needs credits." : response.status === 401 || response.status === 403 ? "Check your fal key permissions, model access, and account credits." : "Check that the reference image is publicly accessible and try again.";
    throw new WorkflowError(`fal returned HTTP ${response.status}. ${reason}`, 502);
  }
  const result = await response.json();
  if (result.has_nsfw_concepts?.some(Boolean)) throw new WorkflowError("fal flagged this output. Try another photo or prompt.", 422);
  const imageUrl = result.images?.[0]?.url;
  if (typeof imageUrl !== "string") throw new WorkflowError("fal returned no image. Try another photo or prompt.", 502);
  return { imageUrl, model: MODEL, seed: result.seed };
}
