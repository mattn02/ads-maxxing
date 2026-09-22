import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import { productResearch } from "./research-fixture";
import { DEFAULT_DESIGN, type Stage } from "../lib/workflow/creative/schema";
import { publicSession } from "../lib/workflow/public-session";
import { researchStateSchema } from "../lib/workflow/research/contracts";
import type { Research, Session, Source } from "../lib/workflow/session-types";
import { createCampaignScope } from "../lib/workflow/research/scope";

const source: Source = { url: "https://store.example/products/case", title: "Case", description: "A real red case", images: ["https://store.example/case.png"], markdown: "A real red case.", fetchedAt: "now", colors: {} };
function fixture(prepareResearch?: (research: Research) => void) {
  const session: Session = { id: randomUUID(), purpose: "campaign", createdAt: "now", updatedAt: "now", messages: [], preferences: {}, variants: [], events: [], research: productResearch(source), researchState: { stage: "awaiting_direction" } };
  const finding = { status: "not_found" as const, value: null };
  session.research!.brandKit = { id: "brand", revision: 1, canonicalStoreUrl: "https://store.example/", name: "Store", logoAssetIds: [], selectedLogoAssetId: null, colors: [], typography: { heading: finding, body: finding, renderFont: "geist-fallback", substitution: "Bundled font" }, voice: finding, audience: finding, valueProposition: finding, overrides: {} };
  const counts = { research: 0, draft: 0, scene: 0, review: 0 };
  let stored = structuredClone(session), time = 0;
  const fail = { research: false, draft: false, scene: false, review: false, slow: false, reservation: false };
  const deps: WorkflowDependencies = {
    now: () => time, save: async value => { if (fail.reservation && value.brief?.sceneCheckpoint?.state === "attempted") { fail.reservation = false; throw new Error("reservation save timed out"); } stored = structuredClone(value); }, readVisual: async () => null, readAsset: async () => Buffer.from("saved"), pinSourceAsset: async () => "saved-source",
    research: async (_input, options) => { counts.research++; if (fail.research) throw new Error("research unavailable"); const next = productResearch(source); next.brandKit = session.research!.brandKit; next.id = randomUUID(); prepareResearch?.(next); await options?.checkpoint?.(next); return next; },
    draftCampaignBrief: async research => { counts.draft++; if (fail.draft) throw new Error("model unavailable"); const product = research.products!.find(item => item.id === research.campaign!.selectedProductId)!; const asset = research.assets!.find(item => item.eligibleAsProductReference && item.productIds.includes(product.id))!; return { design: structuredClone(DEFAULT_DESIGN), productId: product.id, variantId: research.campaign?.selectedVariantId, referenceAssetId: asset.id, productUrl: product.canonicalUrl, referenceImage: asset.originalUrl, headline: "Good grip", cta: "Shop now", direction: "Studio", saleId: null, parentVariantId: null, feedback: "" }; },
    draftRefinement: async (parent, feedback) => { counts.draft++; if (fail.draft) throw new Error("model unavailable"); return { ...parent.brief, headline: "A fresh perspective", feedback, parentVariantId: parent.id, variation: "auto" }; },
    createAd: async (brief, _research, execution) => {
      for (const stage of ["scene"] as Stage[]) {
        if (execution[stage]) continue;
        if (fail.slow) { time += 100_000; fail.slow = false; }
        await execution.beforeAttempt(stage); counts[stage]++;
        if (fail.scene) { await execution.failed?.(stage, { outcome: "unknown", message: "Unknown request outcome" }); throw new Error("image timeout"); }
        await execution.checkpoint(stage, { id: brief.executionPlan![stage].assetId, kind: "generated_scene", inputs: { fingerprint: brief.executionPlan![stage].fingerprint }, prompt: "Fixture", model: "fixture", createdAt: "now" });
      }
      return { id: brief.id, imageUrl: `/api/outputs/${brief.id}`, model: "fixture", prompt: "Fixture", referenceImage: brief.referenceImage, sourceAssetId: brief.sourceAssetId, sceneAssetId: brief.executionPlan!.scene.assetId, sceneAsset: brief.sceneCheckpoint?.asset ?? execution.scene, createdAt: "now" };
    },
    reviewAd: async () => { counts.review++; if (fail.review) throw new Error("review unavailable"); const pass = { status: "pass" as const, reason: "TEST ONLY" }; return { verdict: "pass", checks: [{ name: "fixture", passed: true, detail: "TEST ONLY" }], createdAt: "now", visual: { productFidelity: pass, textLegibility: pass, claimAccuracy: pass, brandFit: pass, summary: "TEST ONLY" } }; },
  };
  let workflow = new Workflow(session, deps);
  return { get workflow() { return workflow; }, counts, fail, reload: () => { workflow = new Workflow(structuredClone(stored), deps); return workflow; } };
}
const input = { direction: "Promote https://store.example/products/case" };

test("one explicit Generate persists intent through research and reload, then plans and generates once", async () => {
  const h = fixture(), requestId = randomUUID();
  await h.workflow.generateCampaign(requestId, input);
  assert.equal(h.counts.research, 1); assert.equal(h.counts.draft, 0);
  assert.equal(researchStateSchema.parse(h.workflow.session.researchState).generationIntent?.requestId, requestId);
  await h.workflow.generateCampaign(requestId, input); assert.equal(h.counts.research, 1);
  await h.reload().continueCampaign(requestId);
  assert.equal(h.workflow.session.brief?.approvalOrigin, "campaign_generate"); assert.equal(h.counts.scene, 0);
  await h.reload().continueCampaign(requestId);
  assert.equal(publicSession(h.workflow.session).nextAction?.kind, "complete");
  await h.reload().continueCampaign(requestId);
  assert.deepEqual(h.counts, { research: 1, draft: 1, scene: 1, review: 1 });
});

test("legacy sessions and mismatched generation IDs cannot dispatch automatically", async () => {
  const h = fixture();
  assert.equal(publicSession(h.workflow.session).nextAction, undefined);
  await assert.rejects(h.workflow.continueCampaign(randomUUID()), /changed/);
  const id = randomUUID(); await h.workflow.generateCampaign(id, input);
  await assert.rejects(h.workflow.generateCampaign(id, { direction: "Different" }), /another/);
  assert.equal(h.counts.scene, 0);
});

test("failed planning pauses for explicit retry and resumes without repeating research", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input);
  h.fail.draft = true; await h.reload().continueCampaign(id);
  assert.equal(publicSession(h.workflow.session).nextAction?.kind, "retry");
  h.fail.draft = false; await h.reload().continueCampaign(id);
  assert.equal(h.counts.research, 1); assert.equal(h.counts.draft, 2);
  assert.equal(publicSession(h.workflow.session).nextAction?.kind, "continue");
});

test("a bounded request defers before the paid scene and resumes in a fresh request", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id);
  h.fail.slow = true; await h.reload().continueCampaign(id);
  assert.equal(publicSession(h.workflow.session).nextAction?.kind, "continue");
  assert.equal(h.counts.scene, 0);
  await h.reload().continueCampaign(id);
  assert.equal(h.counts.scene, 1);
});

test("unknown attempts need explicit duplicate-risk consent; manual retry retains content", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id);
  h.fail.scene = true; await h.reload().continueCampaign(id);
  const failed = structuredClone(h.workflow.session.brief!);
  const next = publicSession(h.workflow.session).nextAction!;
  assert.equal(next.kind, "retry"); assert.equal(next.duplicateRisk, true);
  await assert.rejects(h.reload().continueCampaign(id), /previous|another/i);
  const retryId = randomUUID(); await assert.rejects(h.workflow.retryCreative(retryId, id, failed.id), /Acknowledge/);
  await h.workflow.retryCreative(retryId, id, failed.id, true);
  assert.notEqual(h.workflow.session.brief!.id, failed.id);
  assert.equal(h.workflow.session.brief!.headline, failed.headline);
  assert.equal(h.workflow.session.brief!.sceneCheckpoint, undefined);
  h.fail.scene = false; await h.reload().continueCampaign(retryId);
  assert.equal(h.counts.scene, 2);
  assert.equal(h.workflow.session.variants.length, 1, "An unfinished failed attempt is not a second visible creative");
});

test("review failure retains the finished ad for the user's decision", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input);
  await h.reload().continueCampaign(id); h.fail.review = true; await h.reload().continueCampaign(id);
  assert.equal(h.workflow.session.variants[0].status, "review_failed");
  assert.equal(publicSession(h.workflow.session).nextAction?.kind, "complete");
  assert.equal(h.counts.scene, 1);
});

function twoProducts(research: Research) {
  const another = productResearch({ ...source, url: "https://store.example/products/tote", title: "Tote", images: ["https://store.example/tote.png"] });
  research.products!.push(...another.products!); research.assets!.push(...another.assets!);
  research.campaign!.scope = createCampaignScope(research.products!, research.products!.map(product => ({ productId: product.id, variantId: null })), [source.url]);
  research.campaign!.productIds = research.products!.map(product => product.id);
  research.campaign!.selectedProductId = null; research.campaign!.status = "needs_selection";
}

test("multi-product Generate picks a ready hero and a later member ad retains the whole campaign", async () => {
  const h = fixture(twoProducts), id = randomUUID();
  await h.workflow.generateCampaign(id, input);
  assert.equal(h.workflow.session.researchState!.stage, "ready_for_brief");
  assert.equal(h.workflow.session.research!.campaign!.scope!.members.length, 2);
  await h.reload().continueCampaign(id); await h.reload().continueCampaign(id);
  const research = h.workflow.session.research!, next = research.products![1], second = randomUUID();
  await h.workflow.generateCampaignMember(second, next.id, null);
  await h.reload().continueCampaign(second);
  assert.equal(h.workflow.session.variants.length, 2);
  assert.equal(h.workflow.session.variants[1].brief.productId, next.id);
  assert.equal(h.workflow.session.research!.campaign!.scope!.members.length, 2);
  assert.equal(h.counts.scene, 2);
});

test("generic size/color variants require their exact photo and preserve explicit membership", async () => {
  const h = fixture(research => {
    const product = research.products![0], asset = research.assets!.find(item => item.eligibleAsProductReference)!;
    product.variants = [
      { id: "small-red", title: "Small / Red", storeId: "101", attributes: { Size: "Small", Color: "Red" }, assetIds: [asset.id] },
      { id: "large-blue", title: "Large / Blue", storeId: "102", attributes: { Size: "Large", Color: "Blue" }, assetIds: [] },
    ];
    asset.variantIds = ["small-red"];
    research.campaign!.scope = createCampaignScope(research.products!, [{ productId: product.id, variantId: "small-red" }, { productId: product.id, variantId: "large-blue" }]);
    research.campaign!.selectedProductId = null; research.campaign!.status = "needs_selection";
  });
  const id = randomUUID(); await h.workflow.generateCampaign(id, input);
  assert.equal(h.workflow.session.research!.campaign!.selectedVariantId, "small-red");
  const productId = h.workflow.session.research!.products![0].id;
  await assert.rejects(h.workflow.setCampaignScope([{ productId, variantId: "invented" }]), /actual variant/);
  await h.workflow.generateCampaignMember(randomUUID(), productId, "large-blue");
  assert.equal(publicSession(h.workflow.session).nextAction?.kind, "needs_input");
  assert.equal(h.counts.scene, 0);
});

test("inline feedback creates an immutable child and copy refinement reuses the paid scene", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id); await h.reload().continueCampaign(id);
  const original = structuredClone(h.workflow.session.variants[0]), requestId = randomUUID();
  await h.workflow.refineAd(requestId, original.id, "Change the headline only");
  assert.deepEqual(h.workflow.session.brief!.executionPlan!.scene.action, "reuse");
  await h.reload().continueCampaign(requestId); await h.workflow.refineAd(requestId, original.id, "Change the headline only");
  const child = h.workflow.session.variants[1];
  assert.deepEqual(h.workflow.session.variants[0], original);
  assert.equal(child.brief.parentVariantId, original.id); assert.equal(child.brief.feedback, "Change the headline only");
  assert.notEqual(child.id, original.id); assert.equal(child.brief.headline, "A fresh perspective");
  assert.equal(h.counts.scene, 1);
});

test("explicit regenerate preserves copy and creates one fresh complete scene without a planning call", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id); await h.reload().continueCampaign(id);
  const original = structuredClone(h.workflow.session.variants[0]), requestId = randomUUID(), drafts = h.counts.draft;
  await h.workflow.regenerateAd(requestId, original.id);
  assert.equal(h.workflow.session.brief!.headline, original.brief.headline);
  assert.equal(h.workflow.session.brief!.cta, original.brief.cta);
  assert.equal(h.workflow.session.brief!.parentVariantId, original.id);
  assert.equal(h.workflow.session.brief!.executionPlan!.scene.action, "generate");
  assert.equal(h.counts.draft, drafts);
  await h.reload().continueCampaign(requestId);
  assert.equal(h.workflow.session.variants.length, 2);
  assert.equal(h.counts.scene, 2);
});

test("human acceptance retains uncertain automated review and is revoked on a fresh review", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id); await h.reload().continueCampaign(id);
  const variant = h.workflow.session.variants[0]; variant.status = "needs_human"; variant.review!.verdict = "needs_human";
  const review = structuredClone(variant.review); await h.workflow.approveVariant(variant.id);
  assert.equal(variant.status, "approved"); assert.deepEqual(variant.review, review); assert.equal(variant.acceptance!.reviewedAt, review!.createdAt);
  const acceptedAt = variant.acceptance!.acceptedAt; await h.workflow.approveVariant(variant.id); assert.equal(variant.acceptance!.acceptedAt, acceptedAt);
  await h.workflow.review(variant.id); assert.equal(variant.acceptance, undefined);
  variant.review!.checks[0].passed = false; await h.workflow.approveVariant(variant.id);
  assert.equal(variant.status, "approved");
  await h.workflow.review(variant.id);
  variant.review!.checks = []; await h.workflow.approveVariant(variant.id);
  variant.review!.checks = [{ name: "valid", passed: true, detail: "TEST ONLY" }]; variant.review!.verdict = "needs_changes";
  await h.workflow.review(variant.id); variant.review!.verdict = "needs_changes"; await h.workflow.approveVariant(variant.id);
});

test("refining an older ad keeps current membership, direction and compatible saved scene", async () => {
  const h = fixture(twoProducts), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id); await h.reload().continueCampaign(id);
  const original = structuredClone(h.workflow.session.variants[0]), research = h.workflow.session.research!;
  await h.workflow.selectCampaignMember(research.products![1].id, null);
  const members = structuredClone(h.workflow.session.research!.campaign!.scope!.members), direction = structuredClone(h.workflow.session.research!.campaign!.direction);
  const requestId = randomUUID(); await h.workflow.refineAd(requestId, original.id, "Change the headline only");
  assert.deepEqual(h.workflow.session.research!.campaign!.scope!.members, members);
  assert.deepEqual(h.workflow.session.research!.campaign!.direction, direction);
  assert.notEqual(h.workflow.session.brief!.researchId, original.brief.researchId);
  assert.equal(h.workflow.session.brief!.sourceAssetId, original.sourceAssetId);
  assert.equal(h.workflow.session.brief!.executionPlan!.scene.assetId, original.sceneAssetId);
  await h.reload().continueCampaign(requestId);
  assert.deepEqual(h.workflow.session.variants[0], original);
  assert.equal(h.counts.scene, 1);
  await h.workflow.setCampaignScope([members[1]]);
  await assert.rejects(h.workflow.refineAd(randomUUID(), original.id, "Another headline"), /no longer included/);
});

test("manual photo classification cannot replace missing Shopify ownership", async () => {
  const h = fixture(research => {
    twoProducts(research);
    for (const asset of research.assets!) asset.eligibleAsProductReference = false;
  });
  const requestId = randomUUID(); await h.workflow.generateCampaign(requestId, input);
  assert.equal(publicSession(h.workflow.session).nextAction!.kind, "needs_input");
  const research = h.workflow.session.research!, product = research.products![0], asset = research.assets!.find(item => item.productIds.includes(product.id))!;
  await h.workflow.correctAsset(asset.id, "product_photo", product.id);
  assert.equal(publicSession(h.workflow.session).nextAction!.kind, "needs_input");
  assert.equal(h.workflow.session.research!.campaign!.scope!.members.length, 2);
  await h.reload().continueCampaign(requestId);
  assert.equal(h.workflow.session.variants.length, 0);
});

test("editing research or target cannot discard an unknown paid attempt and silently resubmit", async () => {
  const h = fixture(twoProducts), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id);
  h.fail.scene = true; await h.reload().continueCampaign(id);
  const before = structuredClone(h.workflow.session), research = before.research!, member = research.campaign!.scope!.members[1], asset = research.assets!.find(item => item.productIds.includes(member.productId))!;
  await assert.rejects(h.workflow.setCampaignScope([member]), /unfinished image attempt/);
  await assert.rejects(h.workflow.selectCampaignMember(member.productId, member.variantId), /unfinished image attempt/);
  await assert.rejects(h.workflow.correctAsset(asset.id, "product_photo", member.productId), /unfinished image attempt/);
  await assert.rejects(h.workflow.correctBrand("voice", "Warm"), /unfinished image attempt/);
  await assert.rejects(h.workflow.proposeBrief({ ...before.brief!, headline: "Advanced manual edit" }), /unfinished image attempt/);
  await assert.rejects(h.workflow.generateCampaign(randomUUID(), input), /unfinished image attempt/);
  assert.deepEqual(h.workflow.session, before);
  assert.equal(publicSession(h.workflow.session).nextAction?.duplicateRisk, true);
  assert.equal(h.counts.scene, 1);
});

test("planning compacts an older Shopify source under a new immutable research ID without changing facts or scope", async () => {
  const h = fixture(research => {
    research.sources[0].rawHtml = "large storefront runtime".repeat(1000);
    research.sources[0].shopify = { url: "https://store.example/products/case.js", fetchedAt: "now", product: { id: 1, handle: "case", title: "Case", description: "Real case", options: ["Size"], variants: [{ id: 1, title: "Small", options: ["Small"], price: 999 }], images: source.images, unused: "runtime".repeat(1000) } };
  });
  const id = randomUUID(); await h.workflow.generateCampaign(id, input);
  const original = structuredClone(h.workflow.session.research!); await h.reload().continueCampaign(id);
  const compact = h.workflow.session.research!;
  assert.notEqual(compact.id, original.id); assert.equal(compact.revision, original.revision! + 1);
  assert.deepEqual(compact.products, original.products); assert.deepEqual(compact.assets, original.assets); assert.deepEqual(compact.campaign, original.campaign);
  assert.equal(compact.sources[0].rawHtml, undefined); assert.equal(compact.sources[0].markdown, original.sources[0].markdown);
  assert.equal(compact.sources[0].shopify!.product.unused, undefined);
  assert.equal(h.workflow.session.researchState!.generationIntent!.researchId, compact.id);
  assert.equal(h.workflow.session.brief!.researchId, compact.id);
  assert.ok(original.sources[0].rawHtml); assert.equal(h.counts.scene, 0);
});

test("a failed pre-dispatch reservation does not become a paid unknown when the error is saved", async () => {
  const h = fixture(), id = randomUUID(); await h.workflow.generateCampaign(id, input); await h.reload().continueCampaign(id);
  h.fail.reservation = true; await h.reload().continueCampaign(id);
  assert.equal(h.counts.scene, 0);
  const loaded = h.reload().session;
  assert.equal(loaded.brief!.sceneCheckpoint, undefined); assert.equal(loaded.brief!.generationAttemptedAt, undefined);
  const next = publicSession(loaded).nextAction!;
  assert.equal(next.kind, "retry"); assert.equal(next.duplicateRisk, undefined); assert.equal(next.briefId, undefined);
  await h.workflow.continueCampaign(id);
  assert.equal(h.counts.scene, 1);
});
