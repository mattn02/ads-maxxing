import { z } from "zod";

export const designSchema = z.object({
  version: z.literal(2),
  template: z.enum(["copy-top", "photo-top"]),
  alignment: z.enum(["left", "center"]),
  headlineStyle: z.enum(["standard", "oversized"]),
  ctaStyle: z.enum(["solid", "outline"]),
  background: z.object({ direction: z.string().trim().min(1).max(1000).describe("Environment and lighting only; no product, hands or ad text.") }),
  scene: z.object({ direction: z.string().trim().min(1).max(1000).describe("Product pose and interaction, preserving the original product."), productScale: z.enum(["standard", "large"]) }),
});
export type DesignSpec = z.infer<typeof designSchema>;
export const DEFAULT_DESIGN: DesignSpec = {
  version: 2, template: "copy-top", alignment: "left", headlineStyle: "standard", ctaStyle: "solid",
  background: { direction: "A clean cream studio setting with soft daylight." },
  scene: { direction: "The complete referenced product is clearly visible on the studio surface.", productScale: "standard" },
};
/** Geometry is code-owned and shared by generation and deterministic composition. */
export function templateGeometry(template: DesignSpec["template"]) {
  return { width: 576, height: 1024, copy: { x: 0, y: template === "copy-top" ? 0 : 576, width: 576, height: 448 },
    visual: { x: 0, y: template === "copy-top" ? 448 : 0, width: 576, height: 576 } };
}
export type Stage = "background" | "scene";
export type StageAsset = { id: string; kind: "generated_background" | "generated_scene"; inputs: Record<string, unknown>; prompt: string; model: string; seed?: number; createdAt: string };
export type ProviderResult = { imageUrl: string; model: string; seed?: number; requestId?: string };
export type StageCheckpoint = { state: "attempted" | "output_pending_storage" | "saved"; attemptedAt?: string; provider?: ProviderResult; asset?: StageAsset };
export type StagePlan = { action: "generate" | "reuse"; assetId: string; fingerprint: string };
export type ExecutionPlan = Record<Stage, StagePlan>;
export function executionSummary(plan?: ExecutionPlan) {
  return plan ? `${plan.background.action === "reuse" ? "Reuse background" : "Generate background"} · ${plan.scene.action === "reuse" ? "reuse product scene" : "generate product scene"} · render ad` : "Save a revision to calculate generation steps.";
}
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const brandTokensSchema = z.object({
  background: color, foreground: color, accent: color, ctaForeground: color,
  fontId: z.literal("geist-fallback"),
});
export type BrandTokens = z.infer<typeof brandTokensSchema>;
export const RENDERER_VERSION = 2;
export type VisualInputs = {
  researchId: string; productUrl: string; referenceImage: string; visualDirection: string;
  model: string; background: string; accent: string;
};
export type VisualAsset = {
  id: string; inputs: VisualInputs; prompt: string; model: string; seed?: number; createdAt: string;
};
/** Supplied only by trusted server code after asset verification, never by the design spec. */
export type VerifiedLogo = { bytes: Buffer; width: number; height: number };
