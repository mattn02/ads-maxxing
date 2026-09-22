import type { Brief, Variant } from "../session-types";
import { MODEL } from "../fal-model";
import type { VisualAsset, VisualInputs } from "./schema";

export function visualInputs(brief: Brief): VisualInputs {
  if (!brief.design || !brief.tokens) throw new Error("Brief has no approved design/tokens.");
  return { researchId: brief.researchId, productUrl: brief.productUrl, referenceImage: brief.referenceImage,
    visualDirection: brief.design.visualDirection, model: MODEL,
    background: brief.tokens.background, accent: brief.tokens.accent };
}
export function matchesVisual(brief: Brief, asset: VisualAsset): boolean {
  const expected = visualInputs(brief);
  return asset.model === expected.model && (Object.keys(expected) as (keyof VisualInputs)[]).every(key => expected[key] === asset.inputs[key]);
}
/** Shared by the editor and server; byte existence is checked separately on the server. */
export function compatibleParent(brief: Brief, parent?: Variant): boolean {
  return !!brief.design && !!brief.tokens && !!parent?.visualAsset &&
    parent.id === brief.parentVariantId && parent.visualAssetId === parent.visualAsset.id && matchesVisual(brief, parent.visualAsset);
}
