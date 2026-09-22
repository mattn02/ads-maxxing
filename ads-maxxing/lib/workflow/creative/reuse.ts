import { createHash, randomUUID } from "node:crypto";
import type { Brief, Variant } from "../session-types";
import { MODEL, BACKGROUND_MODEL, IMAGE_SETTINGS, SCENE_SETTINGS, BACKGROUND_PROMPT_VERSION, SCENE_PROMPT_VERSION, SCENE_NORMALIZER_VERSION } from "../fal-model";
import { templateGeometry, type ExecutionPlan, type StageAsset, type VisualAsset } from "./schema";
import { WorkflowError } from "../validation";
const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function backgroundInputs(brief: Brief) {
  if (brief.design?.version !== 2 || !brief.tokens) throw new WorkflowError("Save a V2 design and brand tokens first.");
  return { direction: brief.design.background.direction, palette: [brief.tokens.background, brief.tokens.accent], geometry: templateGeometry(brief.design.template), model: BACKGROUND_MODEL, settings: IMAGE_SETTINGS, promptVersion: BACKGROUND_PROMPT_VERSION };
}
export function sceneInputs(brief: Brief, backgroundAssetId: string) {
  if (!brief.sourceAssetId) throw new WorkflowError("The selected original photo must be saved before approval.");
  return { backgroundAssetId, sourceAssetId: brief.sourceAssetId, direction: brief.design!.scene.direction, productScale: brief.design!.scene.productScale, geometry: templateGeometry(brief.design!.template), model: MODEL, settings: SCENE_SETTINGS, promptVersion: SCENE_PROMPT_VERSION, SCENE_NORMALIZER_VERSION };
}
export function matchesStage(asset: StageAsset | undefined, expected: string) { return !!asset && asset.inputs.fingerprint === expected; }
/** Saved before approval; destination IDs also pin the background consumed by a fresh scene. */
export function planExecution(brief: Brief, parent?: Variant): ExecutionPlan {
  if (parent && parent.id !== brief.parentVariantId) throw new WorkflowError("The reuse parent must be the selected parent variant.");
  const bgKey = fingerprint(backgroundInputs(brief));
  const reuseBackground = brief.variation !== "background" && parent?.backgroundAssetId === parent?.backgroundAsset?.id && matchesStage(parent?.backgroundAsset, bgKey);
  const background = { action: reuseBackground ? "reuse" as const : "generate" as const, assetId: reuseBackground ? parent!.backgroundAsset!.id : randomUUID(), fingerprint: bgKey };
  const sceneKey = fingerprint(sceneInputs(brief, background.assetId));
  const reuseScene = reuseBackground && !["scene", "background"].includes(brief.variation ?? "auto") && parent?.sceneAssetId === parent?.sceneAsset?.id && matchesStage(parent?.sceneAsset, sceneKey);
  return { background, scene: { action: reuseScene ? "reuse" : "generate", assetId: reuseScene ? parent!.sceneAsset!.id : randomUUID(), fingerprint: sceneKey } };
}
export function validatePlan(brief: Brief) {
  const plan = brief.executionPlan;
  if (!plan || plan.background.fingerprint !== fingerprint(backgroundInputs(brief)) || plan.scene.fingerprint !== fingerprint(sceneInputs(brief, plan.background.assetId))) throw new WorkflowError("The saved generation plan no longer matches this brief. Save and approve a new revision.");
}
/** Legacy generated records remain readable; new outputs use separate stage provenance. */
export function matchesVisual(brief: Brief, asset: VisualAsset) {
  return !!brief.design && !!brief.tokens && asset.inputs.researchId === brief.researchId && asset.inputs.productUrl === brief.productUrl && asset.inputs.referenceImage === brief.referenceImage;
}
