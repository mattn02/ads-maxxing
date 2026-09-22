import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import { productResearch } from "./research-fixture";
import { assembleResearch } from "../lib/workflow/agents/researcher";
import { artistPrompt, createAd, type ArtistDependencies } from "../lib/workflow/agents/artist";
import { codeChecks } from "../lib/workflow/agents/reviewer";
import { MODEL } from "../lib/workflow/fal";
import { DEFAULT_DESIGN, designSchema } from "../lib/workflow/creative/schema";
import { resolveBrandTokens, readableText } from "../lib/workflow/creative/tokens";
import { validateCreative } from "../lib/workflow/creative/fit";
import { renderCreative } from "../lib/workflow/creative/render";
import { planExecution, validatePlan } from "../lib/workflow/creative/reuse";
import type { Brief, Source, Session, Variant } from "../lib/workflow/session-types";

const source: Source = { url: "https://store.example/products/case", images: ["https://store.example/photo.png", "https://store.example/other.png"], title: "A case", description: "A real case", markdown: "Members save 10%. Selected cases only. Ends Friday.", colors: {}, fetchedAt: "now" };
const legacyResearch = assembleResearch([source], { voice: "Playful", audience: "Inferred", sales: [{ description: "Member offer", quote: source.markdown, sourceUrl: source.url }] });
const research = { ...productResearch(source), sales: legacyResearch.sales };
const makeBrief = (): Brief => ({ productId: research.products![0].id, referenceAssetId: research.assets!.find(asset => asset.originalUrl === source.images[0])!.id, id: randomUUID(), researchId: research.id, productUrl: source.url, referenceImage: source.images[0], headline: "Hold on to color", cta: "Shop now", direction: "Overall intent", saleId: null, feedback: "", parentVariantId: null, design: { ...DEFAULT_DESIGN }, tokens: resolveBrandTokens(research) });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=", "base64");

test("font fitting retains punctuation and complete offer conditions; overflow and missing glyphs are actionable", async () => {
  const brief = makeBrief();
  brief.headline = "Good grip. Great days. Your case, reimagined.";
  brief.saleId = research.sales[0].id;
  const fitted = await validateCreative(brief, research);
  assert.equal(fitted.headline.lines.join(""), brief.headline);
  assert.equal(fitted.offer!.lines.join(""), source.markdown);
  await assert.rejects(validateCreative({ ...brief, headline: "W".repeat(120) }, research), /Headline does not fit/);
  await assert.rejects(validateCreative({ ...brief, cta: "Shop our extraordinarily wonderful collection today" }, research), /CTA does not fit/);
  await assert.rejects(validateCreative({ ...brief, headline: "Hello \u0001" }, research), /unsupported character/);
  const longOffer = { ...research, sales: [{ ...research.sales[0], quote: source.markdown.repeat(15) }] };
  await assert.rejects(validateCreative(brief, longOffer), /shorter complete source quote/);
  for (const template of ["copy-top", "photo-top"] as const) {
    const output = await renderCreative({ brief: { ...brief, design: { ...brief.design!, template } }, research, tokens: brief.tokens!, visualBytes: png });
    assert.equal(output.readUInt32BE(16), 576);
    assert.equal(output.readUInt32BE(20), 1024);
    assert.ok(output.length > 10000, "The renderer produces a populated PNG");
  }
});

test("emoji copy preserves complete graphemes and renders locally in both templates", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Rendering must not fetch emoji assets"); });
  const brief = { ...makeBrief(), headline: "Celebrate 🎉📱", cta: "Shop 💚✨" };
  for (const emoji of ["🎉", "🦖", "🐆", "👍🏽", "👨‍👩‍👧‍👦", "🇺🇸", "1️⃣", "❤️", "❤️‍🔥", "👁️‍🗨️"]) {
    const copy = await validateCreative({ ...brief, headline: `Hello ${emoji}` }, research);
    assert.equal(copy.headline.lines.join(""), `Hello ${emoji}`);
    assert.deepEqual(Object.keys(copy.headline.emojis), [emoji]);
  }
  await assert.rejects(validateCreative({ ...brief, headline: "🎉".repeat(40) }, research), /Headline does not fit/);
  for (const template of ["copy-top", "photo-top"] as const) {
    const output = await renderCreative({ brief: { ...brief, design: { ...brief.design!, template } }, research, tokens: brief.tokens!, visualBytes: png });
    assert.equal(output.readUInt32BE(16), 576);
    assert.equal(output.readUInt32BE(20), 1024);
  }
});

test("small design contract and token resolver constrain model styling", () => {
  for (const field of ["template", "alignment", "headlineStyle", "ctaStyle"]) assert.equal(designSchema.safeParse({ ...DEFAULT_DESIGN, [field]: "arbitrary-css" }).success, false);
  assert.equal(designSchema.safeParse({ ...DEFAULT_DESIGN, background: { direction: "x".repeat(1001) } }).success, false);
  const tokens = resolveBrandTokens({ ...research, colors: [{ value: "url(https://example.com)", sourceUrl: source.url }, { value: "#123", sourceUrl: source.url }] });
  assert.equal(tokens.background, "#112233");
  assert.equal(tokens.foreground, "#ffffff");
  assert.equal(readableText("#ffffff"), "#000000");
  const brief = makeBrief();
  brief.headline = "COPY_MUST_NOT_REACH_FAL";
  brief.cta = "CTA_MUST_NOT_REACH_FAL";
  brief.feedback = "FEEDBACK_MUST_NOT_REACH_FAL";
  assert.doesNotMatch(artistPrompt(brief), /MUST_NOT_REACH_FAL|Overall intent/);
});

// Test-only fake provider/storage: production never substitutes source composites for scenes.
async function harness() {
  const scenePng = await renderCreative({ brief: makeBrief(), research, tokens: makeBrief().tokens!, visualBytes: png });
  const sourceId = randomUUID();
  const bytes = new Map<string, Buffer>([[sourceId, png]]);
  const counts = { background: 0, scene: 0, render: 0, review: 0 };
  const fail = { compose: false, scene: false, storage: false, review: false, checkpoint: false };
  const session: Session = { id: randomUUID(), createdAt: "now", updatedAt: "now", preferences: {}, messages: [], events: [], variants: [], research: structuredClone(research) };
  let persisted = structuredClone(session);
  const artistDeps: ArtistDependencies = {
    generateBackground: async () => { counts.background++; return { imageUrl: "https://fal.media/background.png", model: "fal-ai/flux-2/klein/4b" }; },
    generateScene: async (source, background, prompt) => { counts.scene++; assert.equal(source, `saved:${sourceId}`); assert.match(background, /^saved:/); assert.notEqual(background, source); assert.match(prompt, /ORIGINAL PRODUCT/); if (fail.scene) throw new Error("scene timeout"); return { imageUrl: "https://fal.media/scene.png", model: MODEL }; },
    saveStageAsset: async input => { if (fail.storage && input.kind === "generated_scene") { fail.storage = false; throw new Error("upload failed"); } const asset = { ...input, id: input.id!, createdAt: "now" }; bytes.set(asset.id, scenePng); return asset; },
    readAsset: async id => bytes.get(id) ?? null,
    assetProviderUrl: async id => `saved:${id}`,
    render: async input => { counts.render++; if (fail.compose) { fail.compose = false; throw new Error("composition failed"); } return renderCreative(input); },
    saveFinal: async (record, output) => { bytes.set(record.id, output); return record; },
  };
  const pass = { status: "pass" as const, reason: "TEST FIXTURE ONLY" };
  const deps: WorkflowDependencies = {
    research: async () => structuredClone(research), pinSourceAsset: async () => sourceId,
    readAsset: artistDeps.readAsset, readVisual: artistDeps.readAsset,
    save: async current => { if (fail.checkpoint && current.brief?.backgroundCheckpoint?.state === "saved") { fail.checkpoint = false; throw new Error("checkpoint failed"); } persisted = structuredClone(current); },
    createAd: (brief, research, execution) => createAd(brief, research, execution, artistDeps),
    reviewAd: async variant => { counts.review++; if (fail.review) { fail.review = false; throw new Error("review failed"); } return { verdict: "pass", checks: codeChecks(variant, bytes.get(variant.id)!), createdAt: "now", visual: { productFidelity: pass, textLegibility: pass, claimAccuracy: pass, brandFit: pass, summary: "TEST FIXTURE ONLY" } }; },
  };
  let workflow = new Workflow(session, deps);
  const approve = async (input = makeBrief()) => { const brief = await workflow.proposeBrief(input); await workflow.approveBrief(brief.id); return brief; };
  const reload = () => workflow = new Workflow(structuredClone(persisted), deps);
  return { get workflow() { return workflow; }, approve, reload, bytes, counts, fail, deps, artistDeps, sourceId };
}

test("two fixed stages, exact composition, and revisions regenerate only their dependencies", async () => {
  const h = await harness();
  await h.approve();
  const first = await h.workflow.generate();
  assert.deepEqual(h.counts, { background: 1, scene: 1, render: 1, review: 1 });
  assert.ok(first.review!.checks.every(check => check.passed));
  assert.equal(first.sourceAssetId, h.sourceId);
  assert.equal((await h.workflow.generate()).id, first.id);
  const revise = (patch: Partial<Brief>) => h.approve({ ...first.brief, parentVariantId: first.id, ...patch });
  const copy = await revise({ headline: "A new headline", design: { ...first.brief.design!, alignment: "center", ctaStyle: "outline" } });
  assert.equal(copy.executionPlan!.scene.action, "reuse");
  assert.equal(copy.executionPlan!.background.action, "reuse");
  const second = await h.workflow.generate();
  assert.equal(second.sceneAssetId, first.sceneAssetId);
  assert.notDeepEqual(h.bytes.get(second.id), h.bytes.get(first.id));
  assert.equal(h.counts.background + h.counts.scene, 2, "copy-only makes zero provider calls");
  await revise({ design: { ...first.brief.design!, scene: { ...first.brief.design!.scene, productScale: "large" } } });
  await h.workflow.generate();
  assert.deepEqual([h.counts.background, h.counts.scene], [1, 2]);
  await revise({ design: { ...first.brief.design!, background: { direction: "A blue tiled bathroom" } } });
  await h.workflow.generate();
  assert.deepEqual([h.counts.background, h.counts.scene], [2, 3]);
  await revise({ design: { ...first.brief.design!, template: "photo-top" } });
  await h.workflow.generate();
  assert.deepEqual([h.counts.background, h.counts.scene], [3, 4], "geometry invalidates both stages");
  await revise({ variation: "scene" }); await h.workflow.generate();
  assert.deepEqual([h.counts.background, h.counts.scene], [3, 5]);
  await revise({ variation: "background" }); await h.workflow.generate();
  assert.deepEqual([h.counts.background, h.counts.scene], [4, 6]);
});

test("saved stages survive upload, composition and review failures across reload without another paid call", async () => {
  for (const failure of ["storage", "compose", "review", "checkpoint"] as const) {
    const h = await harness();
    await h.approve(); h.fail[failure] = true;
    if (failure === "review") {
      const result = await h.workflow.generate();
      assert.equal(result.status, "review_failed");
      h.reload(); await h.workflow.review(result.id);
    } else {
      await assert.rejects(h.workflow.generate(), /failed/);
      h.reload(); await h.workflow.generate();
    }
    assert.deepEqual([h.counts.background, h.counts.scene], [1, 1], failure);
    assert.equal(h.workflow.session.variants.length, 1);
    assert.equal(h.workflow.session.variants[0].status, "reviewed");
  }
});

test("unknown scene attempts preserve background but never resubmit; missing reuse and copy overflow fail before spending", async () => {
  const h = await harness();
  await h.approve(); h.fail.scene = true;
  await assert.rejects(h.workflow.generate(), /scene timeout/);
  assert.equal(h.workflow.session.brief!.backgroundCheckpoint!.state, "saved");
  h.reload(); await assert.rejects(h.workflow.generate(), /already attempted/);
  assert.deepEqual([h.counts.background, h.counts.scene], [1, 1]);
  const clean = await harness(); await clean.approve(); const first = await clean.workflow.generate();
  const next = await clean.approve({ ...first.brief, parentVariantId: first.id, headline: "Updated copy" });
  clean.bytes.delete(first.sceneAssetId!);
  await assert.rejects(clean.workflow.generate(), /bytes are missing/);
  assert.equal(next.generationAttemptedAt, undefined);
  await assert.rejects(clean.workflow.proposeBrief({ ...first.brief, headline: "W".repeat(120) }), /does not fit/);
  assert.deepEqual([clean.counts.background, clean.counts.scene], [1, 1]);
});

test("reuse keys ignore signed URLs/copy but include source identity, settings, geometry and exact background", () => {
  const brief = { ...makeBrief(), sourceAssetId: randomUUID() };
  const plan = planExecution(brief);
  const parent = { id: randomUUID(), backgroundAssetId: plan.background.assetId, sceneAssetId: plan.scene.assetId, backgroundAsset: { id: plan.background.assetId, inputs: { fingerprint: plan.background.fingerprint } }, sceneAsset: { id: plan.scene.assetId, inputs: { fingerprint: plan.scene.fingerprint } } } as unknown as Variant;
  const revision = { ...brief, parentVariantId: parent.id, referenceImage: "https://cdn.example/image?signature=renewed", headline: "Updated" };
  assert.equal(planExecution(revision, parent).scene.action, "reuse");
  assert.equal(planExecution({ ...revision, sourceAssetId: randomUUID() }, parent).scene.action, "generate");
  assert.equal(planExecution({ ...revision, tokens: { ...brief.tokens!, accent: "#123456" } }, parent).background.action, "generate");
  assert.throws(() => validatePlan({ ...brief, executionPlan: plan, design: { ...brief.design!, template: "photo-top" } }), /no longer matches/);
});

test("old draft approvals and forged server fields cannot authorize the new design; finished approvals survive preferences", async () => {
  const h = await harness();
  const forged = await h.workflow.proposeBrief({ ...makeBrief(), ...{ approvedAt: "fake", sourceAssetId: "fake", executionPlan: { fake: true }, backgroundCheckpoint: { state: "saved" } } });
  assert.equal(forged.approvedAt, undefined); assert.equal(forged.backgroundCheckpoint, undefined); assert.equal(forged.sourceAssetId, h.sourceId);
  const legacy = { ...forged, approvedAt: "old" }; delete legacy.design; delete legacy.executionPlan;
  h.workflow.session.brief = legacy;
  await assert.rejects(h.workflow.generate(), /legacy brief/);
  assert.notEqual(h.workflow.session.brief.id, legacy.id); assert.equal(h.workflow.session.brief.approvedAt, undefined);
  await h.workflow.approveBrief(h.workflow.session.brief.id);
  const output = await h.workflow.generate(); const approval = output.brief.approvedAt;
  await h.workflow.remember("tone", "friendly");
  assert.equal(h.workflow.session.brief!.approvedAt, approval);
  await h.workflow.approveVariant(output.id);
  let duringReview = "";
  const workflow = new Workflow(h.workflow.session, { ...h.deps, reviewAd: async variant => { duringReview = variant.status; return output.review!; } });
  await workflow.review(output.id); assert.equal(duringReview, "pending_review");
});

test("fal adapters require both scene references and isolate model settings", async t => {
  const { generateScene, generateBackground } = await import("../lib/workflow/fal");
  const previous = process.env.FAL_AI_API_KEY; process.env.FAL_AI_API_KEY = "fixture";
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(init.body as string) }); return Response.json({ images: [{ url: "https://fal.media/fixture.png" }], seed: 1 }, { headers: { "x-fal-request-id": "provider-fixture" } }); });
  try {
    await generateBackground("environment only");
    const scene = await generateScene("https://storage.example/original", "https://storage.example/background", "product scene");
    assert.equal(scene.requestId, "provider-fixture");
    assert.equal(requests[0].body.image_urls, undefined);
    assert.deepEqual(requests[0].body.image_size, { width: 576, height: 1024 });
    assert.deepEqual(requests[1].body.image_urls, ["https://storage.example/original", "https://storage.example/background"]);
    assert.equal(requests[1].body.aspect_ratio, "9:16"); assert.equal(requests[1].body.resolution, "1K");
    assert.equal(requests[1].body.image_size, undefined);
    assert.throws(() => generateScene("", "background", "prompt"), /saved original and background/);
  } finally { if (previous === undefined) delete process.env.FAL_AI_API_KEY; else process.env.FAL_AI_API_KEY = previous; }
});

test("scene normalization preserves full portrait extent and rejects landscape or corrupt input", async () => {
  const { ImageResponse } = await import("next/og");
  const { createElement } = await import("react");
  const { normalizeScenePng } = await import("../lib/workflow/creative/render");
  const portrait = Buffer.from(await new ImageResponse(createElement("div", { style: { width: 768, height: 1376, display: "flex", background: "red", border: "20px solid blue" } }), { width: 768, height: 1376 }).arrayBuffer());
  const result = await normalizeScenePng(portrait);
  assert.equal(result.readUInt32BE(16), 576); assert.equal(result.readUInt32BE(20), 1024);
  await assert.rejects(normalizeScenePng(png), /portrait image/);
  await assert.rejects(normalizeScenePng(Buffer.from("bad")), /return a PNG/);
});
