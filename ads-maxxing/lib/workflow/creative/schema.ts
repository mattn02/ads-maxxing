import { z } from "zod";

export const designSchema = z.object({
  template: z.enum(["copy-top", "photo-top"]),
  alignment: z.enum(["left", "center"]),
  headlineStyle: z.enum(["standard", "oversized"]).describe("Oversized creates stronger headline hierarchy."),
  ctaStyle: z.enum(["solid", "outline"]).describe("Outline makes the CTA quieter."),
  visualDirection: z.string().trim().min(1).max(1000).describe("Product scene only, without advertising text."),
  reuseVisualFromVariantId: z.string().uuid().nullable().describe("Reuse a compatible parent visual for copy/style/layout edits; null requests a new visual."),
});
export type DesignSpec = z.infer<typeof designSchema>;
export const DEFAULT_DESIGN: DesignSpec = {
  template: "copy-top", alignment: "left", headlineStyle: "standard", ctaStyle: "solid",
  visualDirection: "A clean studio product scene with soft lighting and the complete product visible.",
  reuseVisualFromVariantId: null,
};
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const brandTokensSchema = z.object({
  background: color, foreground: color, accent: color, ctaForeground: color,
  fontId: z.literal("geist-fallback"),
});
export type BrandTokens = z.infer<typeof brandTokensSchema>;
export const RENDERER_VERSION = 1;
export type VisualInputs = {
  researchId: string; productUrl: string; referenceImage: string; visualDirection: string;
  model: string; background: string; accent: string;
};
export type VisualAsset = {
  id: string; inputs: VisualInputs; prompt: string; model: string; seed?: number; createdAt: string;
};
/** Supplied only by trusted server code after asset verification, never by the design spec. */
export type VerifiedLogo = { bytes: Buffer; width: number; height: number };
