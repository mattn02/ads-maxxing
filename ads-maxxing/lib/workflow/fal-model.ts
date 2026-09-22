// Versions/settings participate in stable reuse keys. No expiring URLs here.
export const BACKGROUND_MODEL = "fal-ai/flux-2/klein/4b";
export const MODEL = "fal-ai/nano-banana-pro/edit";
export const IMAGE_SETTINGS = { image_size: { width: 576, height: 1024 }, num_images: 1, num_inference_steps: 4, output_format: "png", enable_safety_checker: true } as const;
export const BACKGROUND_PROMPT_VERSION = 2;
export const SCENE_NORMALIZER_VERSION = 1;
export const SCENE_PROMPT_VERSION = 3;
export const SCENE_SETTINGS = { aspect_ratio: "9:16", resolution: "1K", num_images: 1, output_format: "png", limit_generations: true } as const;
