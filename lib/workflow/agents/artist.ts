import { generateScene, assertImageConfiguration, ImageRequestError } from "../fal";
import { safeError } from "../validation";
import { readAsset, assetProviderUrl, saveComposedGeneration, saveStageAsset } from "../storage";
import type { Brief, Research } from "../session-types";
import { renderCreative } from "../creative/render";
import { resolveCommercialCopy, validateCreative } from "../creative/fit";
import { sceneInputs, matchesStage, validatePlan } from "../creative/reuse";
import { scenePrompt } from "../creative/scene";
import { RENDERER_VERSION, type Stage, type StageAsset, type ProviderResult } from "../creative/schema";
import { imageMetadata } from "../asset-download";
import { WorkflowError } from "../validation";

export const artistPrompt = scenePrompt;
export type ArtistExecution = {
  scene?: StageAsset;
  beforeAttempt: (stage: Stage) => Promise<void>;
  providerResult: (stage: Stage, result: ProviderResult) => Promise<void>;
  checkpoint: (stage: Stage, asset: StageAsset) => Promise<void>;
  failed?: (stage: Stage, failure: { outcome: "rejected" | "unknown"; message: string }) => Promise<void>;
};
export type ArtistDependencies = {
  preflight?: typeof assertImageConfiguration;
  generateScene: typeof generateScene;
  saveStageAsset: typeof saveStageAsset; readAsset: typeof readAsset; assetProviderUrl: typeof assetProviderUrl;
  render: typeof renderCreative; saveFinal: typeof saveComposedGeneration;
};
const defaults: ArtistDependencies = { preflight: assertImageConfiguration, generateScene, saveStageAsset, readAsset, assetProviderUrl, render: renderCreative, saveFinal: saveComposedGeneration };
export async function createAd(brief: Brief, research: Research, execution: ArtistExecution, deps: ArtistDependencies = defaults) {
  await validateCreative(brief, research);
  validatePlan(brief, research);
  if (!brief.sourceAssetId || !await deps.readAsset(brief.sourceAssetId)) throw new WorkflowError("Saved original photo is missing. Restore it before generating.");
  const logo = brief.logoSourceAssetId ? await deps.readAsset(brief.logoSourceAssetId) : undefined;
  if (brief.logoSourceAssetId && !logo) throw new WorkflowError("The approved logo is missing. Restore it before generating.");
  const logoBytes = logo ? { bytes: logo, ...imageMetadata(logo) } : undefined;
  // Check every planned reuse BEFORE spending on either stage.
  for (const stage of ["scene"] as const) {
    const plan = brief.executionPlan![stage];
    const asset = execution[stage];
    if (asset && (asset.id !== plan.assetId || !matchesStage(asset, plan.fingerprint))) throw new WorkflowError(`Saved ${stage} is incompatible with the approved plan.`);
    if ((plan.action === "reuse" || brief[`${stage}Checkpoint`]?.state === "saved") && !asset) throw new WorkflowError(`The approved reused ${stage} is missing. No replacement will be generated.`);
    if (asset && !await deps.readAsset(asset.id)) throw new WorkflowError(`Saved ${stage} bytes are missing. Restore them before finishing.`);
  }
  async function stageAsset(stage: Stage, generate: () => Promise<ProviderResult>, prompt: string, inputs: Record<string, unknown>) {
    if (execution[stage]) { await execution.checkpoint(stage, execution[stage]!); return execution[stage]!; }
    const checkpoint = brief[`${stage}Checkpoint`];
    let provider = checkpoint?.provider;
    if (!provider) {
      if (checkpoint?.attemptedAt || checkpoint?.state === "attempted") throw new WorkflowError(`The ${stage} request was already attempted and its outcome is unknown. Inspect the saved attempt; another paid request needs a new approved revision.`, 409);
      deps.preflight?.();
      await execution.beforeAttempt(stage);
      try { provider = await generate(); }
      catch (error) { await execution.failed?.(stage, { outcome: error instanceof ImageRequestError ? error.outcome : "unknown", message: safeError(error) }); throw error; }
      await execution.providerResult(stage, provider); // Recovery URL before any download/upload.
    }
    const asset = await deps.saveStageAsset({ id: brief.executionPlan![stage].assetId, kind: "generated_scene", ...provider, prompt, inputs: { ...inputs, fingerprint: brief.executionPlan![stage].fingerprint } });
    await execution.checkpoint(stage, asset);
    return asset;
  }
  // Resolve storage access before marking a paid attempt; a signing failure spent nothing.
  const sourceUrl = !execution.scene && !brief.sceneCheckpoint?.provider
    ? await deps.assetProviderUrl(brief.sourceAssetId!) : undefined;
  const sceneText = scenePrompt(brief, research);
  const scene = await stageAsset("scene", () => deps.generateScene(sourceUrl!, sceneText), sceneText, sceneInputs(brief, research));
  const bytes = await deps.readAsset(scene.id);
  if (!bytes) throw new WorkflowError("Saved scene bytes are missing. Restore the scene before composition.");
  if (bytes.length < 24 || bytes.readUInt32BE(16) !== 576 || bytes.readUInt32BE(20) !== 1024) throw new WorkflowError("The generated scene must be a full 576 × 1024 PNG. Save a revised brief; do not crop away product details.");
  const output = await deps.render({ brief, research, tokens: brief.tokens!, visualBytes: bytes, logoBytes });
  const commercial = resolveCommercialCopy(brief, research);
  return deps.saveFinal({
    id: brief.id, imageUrl: `/api/outputs/${brief.id}`, model: scene.model, prompt: scene.prompt,
    referenceImage: brief.referenceImage, sourceAssetId: brief.sourceAssetId, createdAt: new Date().toISOString(),
    sceneAssetId: scene.id, sceneAsset: scene,
    design: brief.design!, tokens: brief.tokens!, rendererVersion: RENDERER_VERSION,
    renderedCopy: { headline: brief.headline, cta: brief.cta, price: commercial.price, offer: commercial.offer },
  }, output);
}
