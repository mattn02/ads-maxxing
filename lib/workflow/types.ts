import type { BrandTokens, DesignSpec, VisualAsset, StageAsset } from "./creative/schema";

export type Product = { url: string; title: string; description: string; images: string[]; markdown: string };
export type Generation = {
  id: string;
  /** The final composed PNG, never an intermediate provider URL. */
  imageUrl: string;
  model: string;
  prompt: string;
  referenceImage: string;
  createdAt: string;
  // Optional only for legacy, full-image generations.
  sourceAssetId?: string;
  backgroundAssetId?: string;
  backgroundAsset?: StageAsset;
  sceneAssetId?: string;
  sceneAsset?: StageAsset;
  visualAssetId?: string;
  visualAsset?: VisualAsset;
  design?: DesignSpec;
  tokens?: BrandTokens;
  rendererVersion?: number;
  renderedCopy?: { headline: string; cta: string; price: string | null; offer: string | null };
};
