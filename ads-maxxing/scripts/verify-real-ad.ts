/** Explicit, bounded live workflow check. Uses an observed store photo and real review. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { configuration, ownerContext, persistenceContext, rows, supabase } from "../lib/supabase/server";
import { createSession, loadBrandResearch, loadSession, lockSession, saveSession, sessionId } from "../lib/workflow/sessions";
import { Workflow } from "../lib/workflow/service";
import { research } from "../lib/workflow/agents/researcher";
import { createAd } from "../lib/workflow/agents/artist";
import { reviewAd } from "../lib/workflow/agents/reviewer";
import { generateScene } from "../lib/workflow/fal";
import { assetProviderUrl, pinSourceAsset, readAsset, readImage, readVisual, saveComposedGeneration, saveStageAsset } from "../lib/workflow/storage";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import { renderCreative } from "../lib/workflow/creative/render";
import { imageMetadata } from "../lib/workflow/asset-download";
import { safeError } from "../lib/workflow/validation";

type Run = { sourceCampaignId: string; campaignId: string; briefId: string; previousBriefIds?: string[]; sourceAssetId: string; sourceUrl: string; attempts: { stage: "scene"; at: string }[] };

async function main() {
  const configuredOrigin = new URL(configuration().url).origin;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...arguments_: Parameters<typeof fetch>) => {
    const started = Date.now();
    const response = await originalFetch(...arguments_);
    const target = new URL(arguments_[0] instanceof Request ? arguments_[0].url : String(arguments_[0]));
    if (!response.ok && target.origin === configuredOrigin) {
      const body = await response.clone().json().catch(() => ({}));
      // Provider payloads and signed URLs never enter the diagnostic report.
      console.error(JSON.stringify({ service: "supabase", path: target.pathname, status: response.status, code: body.code, message: typeof body.message === "string" ? body.message.replace(/https?:\S+/g, "[url]").replace(/(?:Bearer|Key)\s+\S+/gi, "[credential]") : undefined }));
    }
    if (target.origin === configuredOrigin && target.pathname.endsWith("/rpc/commit_campaign")) console.log(JSON.stringify({ checkpoint: "commit_campaign", status: response.status, durationMs: Date.now() - started, payloadBytes: Buffer.byteLength(String(arguments_[1]?.body || "")) }));
    return response;
  };
  const [mode, runDirectory, argument] = process.argv.slice(2);
  if (!runDirectory || !["prepare", "generate", "recompose", "review", "verify"].includes(mode)) throw new Error("Usage: node --env-file=.env.local --import tsx scripts/verify-real-ad.ts prepare <new-run-directory> <source-campaign-id> | generate <run-directory> --allow-one-paid-call | recompose <run-directory> | review <run-directory> | verify <run-directory>");
  const directory = path.resolve(runDirectory);
  const runFile = path.join(directory, "run.json");
  let run: Run;
  let campaignId: string;
  if (mode === "prepare") {
    campaignId = sessionId(argument);
    await mkdir(directory); // A new run must never replace uncertain paid attempts.
  } else {
    run = JSON.parse(await readFile(runFile, "utf8"));
    campaignId = sessionId(run.campaignId);
  }
  // Resolve ownership once from the explicitly named campaign, then use the same
  // owner-scoped persistence functions and guarded lease as the application.
  const [owner] = await (await supabase(`/rest/v1/campaigns?id=eq.${campaignId}&select=user_id`)).json() as { user_id: string }[];
  assert.ok(owner?.user_id, "The named campaign must exist");
  await persistenceContext.run({ userId: owner.user_id }, async () => {
    if (mode === "prepare") {
      const original = await loadSession(campaignId);
      const saved = original.research;
      const product = saved?.products?.find(item => item.id === saved.campaign?.selectedProductId);
      const reference = saved?.assets?.find(item => item.productIds.includes(product?.id || "") && item.eligibleAsProductReference && item.classification === "verified_structure" && item.role === "product_photo");
      assert.ok(saved?.brandKit && product && reference, "A selected observed product and verified photo are required");
      assert.equal(new URL(reference.originalUrl).hostname, "www.loopycases.com", "This bounded check is for a public Loopy original photo");
      const session = await createSession();
      const release = await lockSession(session.id);
      try {
        session.research = structuredClone(saved);
        session.researchState = structuredClone(original.researchState);
        session.preferences.campaignName = `Verification · ${product.title} · ${new Date().toISOString().slice(0, 10)}`;
        await saveSession(session);
        const workflow = new Workflow(session);
        const design = structuredClone(DEFAULT_DESIGN);
        design.scene.direction = "Show the exact reference case upright on the studio surface, printed back and real finger loop clearly visible. Preserve its exact pink color, loop, shape, and camera openings. No hand.";
        const brief = await workflow.proposeBrief({ productId: product.id, referenceAssetId: reference.id, logoAssetId: null, productUrl: product.canonicalUrl, referenceImage: reference.originalUrl, headline: "Your everyday hold", cta: "Shop Loopy", direction: `An evergreen product ad for ${product.title}, grounded in the saved real product photograph.`, feedback: "", saleId: null, parentVariantId: null, design });
        run = { sourceCampaignId: original.id, campaignId: session.id, briefId: brief.id, sourceAssetId: brief.sourceAssetId!, sourceUrl: reference.originalUrl, attempts: [] };
        await writeFile(runFile, JSON.stringify(run, null, 2));
        const bytes = await readAsset(run.sourceAssetId);
        assert.ok(bytes);
        await writeFile(path.join(directory, `original.${imageMetadata(bytes).extension}`), bytes);
        console.log(JSON.stringify({ prepared: true, campaignId: session.id, briefId: brief.id, sourceAssetId: brief.sourceAssetId, publicSourceUrl: reference.originalUrl, paidCalls: 0, next: "Visually inspect original, then explicitly run generate --allow-one-paid-call" }));
      } finally { await release(); }
      return;
    }
    if (["generate", "recompose", "review"].includes(mode)) {
      if (mode === "generate") assert.equal(argument, "--allow-one-paid-call", "Paid generation requires the explicit bounded flag");
      const release = await lockSession(run!.campaignId);
      try {
        const session = await loadSession(run!.campaignId);
        assert.equal(session.brief?.id, run!.briefId, "Verification must use the same immutable brief");
        const recordAttempt = async (stage: "scene") => {
          assert.equal(mode, "generate", "Recomposition and review must never submit a model image request");
          assert.ok(run!.attempts.length < 1 && !run!.attempts.some(item => item.stage === stage), "The live check permits one complete scene and never repeats it");
          run!.attempts.push({ stage, at: new Date().toISOString() });
          await writeFile(runFile, JSON.stringify(run, null, 2));
          console.log(JSON.stringify({ submittedStage: stage, totalPaidAttempts: run!.attempts.length }));
        };
        const workflow = new Workflow(session, { loadBrandResearch, research, reviewAd, save: saveSession, readVisual, readAsset, pinSourceAsset,
          createAd: (brief, saved, execution) => createAd(brief, saved, execution, {
            generateScene: async (source, prompt) => { await recordAttempt("scene"); return generateScene(source, prompt); },
            saveStageAsset, readAsset, assetProviderUrl, render: renderCreative, saveFinal: saveComposedGeneration,
          }),
        });
        if (mode === "recompose") {
          const previous = session.variants.find(item => item.id === run!.briefId);
          assert.ok(previous, "Recomposition requires a completed saved parent");
          const next = await workflow.proposeBrief({ ...previous.brief, parentVariantId: previous.id, variation: "auto", feedback: "Preserve the complete saved product scene outside the copy panel." });
          assert.equal(next.executionPlan?.scene.action, "reuse");
          run!.previousBriefIds = [...(run!.previousBriefIds || []), run!.briefId];
          run!.briefId = next.id;
          await writeFile(runFile, JSON.stringify(run, null, 2));
        }
        if (mode !== "review" && !session.brief!.approvedAt) await workflow.approveBrief(run!.briefId);
        const variant = mode === "review" ? await workflow.review(run!.briefId) : await workflow.generate(run!.briefId);
        console.log(JSON.stringify({ generated: true, campaignId: session.id, variantId: variant.id, status: variant.status, review: variant.review?.verdict, totalPaidAttempts: run!.attempts.length }));
      } finally { await release(); }
    }
    const loaded = await loadSession(run!.campaignId);
    const variant = loaded.variants.find(item => item.id === run!.briefId);
    if (!variant) {
      console.log(JSON.stringify({ complete: false, campaignId: loaded.id, scene: loaded.brief?.sceneCheckpoint?.state, totalPaidAttempts: run!.attempts.length }));
      return;
    }
    assert.equal(variant.sourceAssetId, run!.sourceAssetId);
    assert.equal(variant.referenceImage, run!.sourceUrl);
    const bytes = await readImage(variant.id);
    assert.ok(bytes);
    assert.deepEqual(imageMetadata(bytes), { mime: "image/png", width: 576, height: 1024, extension: "png" });
    await writeFile(path.join(directory, "ad.png"), bytes);
    const assets = await rows<{ id: string; kind: string; storage_state: string; source_url: string | null; source_research_id: string | null; content_hash: string; width: number; height: number }>("assets", `campaign_id=eq.${loaded.id}&select=id,kind,storage_state,source_url,source_research_id,content_hash,width,height`);
    assert.equal(assets.find(item => item.id === variant.sourceAssetId)?.source_url, run!.sourceUrl);
    assert.ok(assets.some(item => item.kind === "composed_ad" && item.id === variant.id && item.storage_state === "ready"));
    const report = { complete: true, campaignId: loaded.id, variantId: variant.id, sourceAssetId: variant.sourceAssetId, originalUrl: run!.sourceUrl, outputRoute: variant.imageUrl, dimensions: [576, 1024], reviewStatus: variant.status, review: variant.review, reviewError: variant.reviewError, totalPaidAttempts: run!.attempts.length, assets, ownerScoped: !!ownerContext().userId, storageHost: new URL(configuration().url).hostname };
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ complete: true, campaignId: loaded.id, outputRoute: variant.imageUrl, dimensions: [576, 1024], reviewStatus: variant.status, totalPaidAttempts: run!.attempts.length, artifact: path.join(directory, "ad.png") }));
  });
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
