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
  background: { direction: "A bold, polished lifestyle setting with natural depth and directional light." },
  scene: { direction: "An audience-appropriate person actively uses the exact referenced product, with the complete product and contact point clearly visible.", productScale: "standard" },
};
/** Geometry is code-owned and shared by generation and deterministic composition. */
export function templateGeometry(_template: DesignSpec["template"]) {
  void _template; // Retained for compatibility with saved V2 design records.
  return { width: 576, height: 1024, copy: { x: 0, y: 0, width: 576, height: 240 },
    visual: { x: 0, y: 0, width: 576, height: 1024 } };
}
export type Stage = "scene";
export type StageAsset = { id: string; kind: "generated_background" | "generated_scene"; inputs: Record<string, unknown>; prompt: string; model: string; seed?: number; createdAt: string };
export type ProviderResult = { imageUrl: string; model: string; seed?: number; requestId?: string };
export type StageCheckpoint = { state: "attempted" | "output_pending_storage" | "saved"; attemptedAt?: string; provider?: ProviderResult; asset?: StageAsset; failure?: { outcome: "rejected" | "unknown"; message: string } };
export type StagePlan = { action: "generate" | "reuse"; assetId: string; fingerprint: string };
export type ExecutionPlan = { scene: StagePlan };
export function executionSummary(plan?: ExecutionPlan) {
  return plan ? `${plan.scene.action === "reuse" ? "Reuse product scene" : "Generate complete product scene"} · render exact copy` : "Save a revision to calculate generation steps.";
}
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const brandTokenColors = {
  background: color, foreground: color, accent: color, ctaForeground: color,
};
export const brandTokensSchema = z.discriminatedUnion("fontId", [
  z.object({ ...brandTokenColors, fontId: z.literal("geist-fallback") }),
  z.object({
    ...brandTokenColors,
    fontId: z.literal("fontsource"),
    sourceId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    family: z.string().trim().min(1).max(200),
    weight: z.literal(400),
    style: z.literal("normal"),
    format: z.enum(["ttf", "woff"]),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    fileUrl: z.string().url(),
  }),
]);
export type BrandTokens = z.infer<typeof brandTokensSchema>;
export function creativeFontFamily(tokens: BrandTokens) {
  return tokens.fontId === "fontsource" ? tokens.family : "Geist";
}
export const RENDERER_VERSION = 7;
export type VisualInputs = {
  researchId: string; productUrl: string; referenceImage: string; visualDirection: string;
  model: string; background: string; accent: string;
};
export type VisualAsset = {
  id: string; inputs: VisualInputs; prompt: string; model: string; seed?: number; createdAt: string;
};
/** Supplied only by trusted server code after asset verification, never by the design spec. */
export type VerifiedLogo = { bytes: Buffer; width: number; height: number; mime?: string };
