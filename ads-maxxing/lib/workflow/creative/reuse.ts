import { createHash, randomUUID } from "node:crypto";
import type { Brief, Research, Variant } from "../session-types";
import { MODEL, SCENE_SETTINGS, SCENE_PROMPT_VERSION, SCENE_NORMALIZER_VERSION } from "../fal-model";
import { templateGeometry, type ExecutionPlan, type StageAsset, type VisualAsset } from "./schema";
import { WorkflowError } from "../validation";
import { visualPromptContext } from "./context";
const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const isResearch = (value: Research | Brief | Variant | undefined): value is Research => !!value && Array.isArray((value as Research).sources);
export function sceneInputs(brief: Brief, research?: Research) {
  if (brief.design?.version !== 2 || !brief.tokens) throw new WorkflowError("Save a V2 design and brand tokens first.");
  if (!brief.sourceAssetId) throw new WorkflowError("The selected original photo must be saved before approval.");
  return { context: visualPromptContext(brief, research), sourceAssetId: brief.sourceAssetId, setting: brief.design.background.direction, direction: brief.design.scene.direction, productScale: brief.design.scene.productScale, palette: [brief.tokens.background, brief.tokens.accent], geometry: templateGeometry(brief.design.template), model: MODEL, settings: SCENE_SETTINGS, promptVersion: SCENE_PROMPT_VERSION, SCENE_NORMALIZER_VERSION };
}
export function matchesStage(asset: StageAsset | undefined, expected: string) { return !!asset && asset.inputs.fingerprint === expected; }
/** Saved before approval; the fingerprint pins every input to the one paid scene call. */
export function planExecution(brief: Brief, researchOrParent?: Research | Variant, maybeParent?: Variant): ExecutionPlan {
  const research = isResearch(researchOrParent) ? researchOrParent : undefined;
  const parent = research ? maybeParent : researchOrParent as Variant | undefined;
  if (parent && parent.id !== brief.parentVariantId) throw new WorkflowError("The reuse parent must be the selected parent variant.");
  const sceneKey = fingerprint(sceneInputs(brief, research));
  const reuseScene = (brief.variation ?? "auto") === "auto" && parent?.sceneAssetId === parent?.sceneAsset?.id && matchesStage(parent?.sceneAsset, sceneKey);
  return { scene: { action: reuseScene ? "reuse" : "generate", assetId: reuseScene ? parent!.sceneAsset!.id : randomUUID(), fingerprint: sceneKey } };
}
export function validatePlan(brief: Brief, research?: Research) {
  const plan = brief.executionPlan;
  if (!plan || plan.scene.fingerprint !== fingerprint(sceneInputs(brief, research))) throw new WorkflowError("The saved generation plan no longer matches this brief. Save and approve a new revision.");
}
/** Retry an unfinished revision without discarding completed immutable stages. */
export function retryExecution(brief: Brief, researchOrPrevious: Research | Brief, maybePrevious?: Brief) {
  const research = isResearch(researchOrPrevious) ? researchOrPrevious : undefined;
  const previous: Brief = research ? maybePrevious! : researchOrPrevious as Brief;
  const plan = planExecution(brief, research);
  const scene = previous.sceneCheckpoint?.state === "saved" ? previous.sceneCheckpoint.asset : undefined;
  if (scene && matchesStage(scene, plan.scene.fingerprint)) {
    plan.scene = { action: "reuse", assetId: scene.id, fingerprint: plan.scene.fingerprint };
    brief.sceneCheckpoint = structuredClone(previous.sceneCheckpoint);
  }
  return plan;
}
/** Legacy generated records remain readable; new outputs use separate stage provenance. */
export function matchesVisual(brief: Brief, asset: VisualAsset) {
  return !!brief.design && !!brief.tokens && asset.inputs.researchId === brief.researchId && asset.inputs.productUrl === brief.productUrl && asset.inputs.referenceImage === brief.referenceImage;
}
