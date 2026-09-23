import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import { productResearch } from "./research-fixture";
import { assembleResearch } from "../lib/workflow/agents/researcher";
import { artistPrompt, createAd, type ArtistDependencies } from "../lib/workflow/agents/artist";
import { codeChecks } from "../lib/workflow/agents/reviewer";
import { MODEL } from "../lib/workflow/fal";
import { DEFAULT_DESIGN, designSchema } from "../lib/workflow/creative/schema";
import { resolveBrandTokens, readableText } from "../lib/workflow/creative/tokens";
import { resolveCommercialCopy, validateCreative } from "../lib/workflow/creative/fit";
import { renderCreative } from "../lib/workflow/creative/render";
import { planExecution, validatePlan } from "../lib/workflow/creative/reuse";
import type { Brief, Source, Session, Variant } from "../lib/workflow/session-types";

const source: Source = { url: "https://store.example/products/case", images: ["https://store.example/photo.png", "https://store.example/other.png"], title: "A case", description: "A real case", markdown: "Members save 10%. Selected cases only. Ends Friday.", colors: {}, fetchedAt: "now" };
const legacyResearch = assembleResearch([source], { voice: "Playful", audience: "Inferred", sales: [{ description: "Member offer", quote: source.markdown, sourceUrl: source.url }] });
const baseResearch = productResearch(source);
const research = { ...baseResearch, sales: legacyResearch.sales, offers: legacyResearch.sales.map(sale => ({ id: sale.id, sourceUrl: sale.sourceUrl, quote: sale.quote, displayCopy: sale.quote, restrictions: sale.quote, productIds: [baseResearch.products![0].id], checkedAt: new Date().toISOString(), eligibility: "eligible" as const, endsAt: null, confirmedAt: new Date().toISOString(), confirmationOrigin: "user_supplied" as const })) };
const geistTokens = { background: "#f6f3ee", foreground: "#000000", accent: "#000000", ctaForeground: "#ffffff", fontId: "geist-fallback" as const };
const makeBrief = (): Brief => ({ productId: research.products![0].id, referenceAssetId: research.assets!.find(asset => asset.originalUrl === source.images[0])!.id, id: randomUUID(), researchId: research.id, productUrl: source.url, referenceImage: source.images[0], headline: "Hold on to color", cta: "Shop now", direction: "Overall intent", saleId: null, feedback: "", parentVariantId: null, design: { ...DEFAULT_DESIGN }, tokens: { ...geistTokens } });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=", "base64");

test("composition and review share plain offer copy while preserving exact source evidence", async () => {
  const quote = "###### **Get Free** US Ground Advantage Shipping On Orders $55+";
  const offerResearch = structuredClone(research);
  offerResearch.sources[0].markdown = quote;
  offerResearch.sales[0].quote = quote;
  offerResearch.offers[0].quote = quote;
  const brief = { ...makeBrief(), saleId: offerResearch.sales[0].id };
  const commercial = resolveCommercialCopy(brief, offerResearch);
  assert.equal(commercial.offer, "Get Free US Ground Advantage Shipping On Orders $55+");
  const fitted = await validateCreative(brief, offerResearch);
  assert.equal(fitted.offer!.lines.join(""), commercial.offer);
  const variant = { rendererVersion: 6, brief, research: offerResearch, renderedCopy: { headline: brief.headline, cta: brief.cta, ...commercial } } as Variant;
  const checks = codeChecks(variant, png);
  assert.equal(checks.find(check => check.name === "exact_copy")!.passed, true);
  assert.equal(checks.find(check => check.name === "sale_evidence")!.passed, true);
  assert.equal(offerResearch.sales[0].quote, quote);
  assert.equal(offerResearch.sources[0].markdown, quote);
});

test("the transparent overlay preserves the full scene in both legacy template modes", async () => {
  const scene = await sharp(Buffer.from('<svg width="576" height="1024"><rect width="576" height="1024" fill="#ff00ff"/><rect width="576" height="64" fill="#00ff00"/><rect y="960" width="576" height="64" fill="#0000ff"/></svg>')).png().toBuffer();
  for (const template of ["copy-top", "photo-top"] as const) {
    const brief = makeBrief(); brief.design = { ...brief.design!, template };
    const output = await renderCreative({ brief, research, tokens: brief.tokens!, visualBytes: scene });
    const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (y: number) => [...data.subarray((y * info.width + 288) * info.channels, (y * info.width + 288) * info.channels + 3)];
    assert.deepEqual(pixel(300), [255, 0, 255], `${template} has no copy-panel fill`);
    assert.deepEqual(pixel(1010), [0, 0, 255], `${template} preserves the bottom scene detail`);
  }
});

test("logo stays top-left and headline stays at the top", async () => {
  const scene = await sharp({ create: { width: 576, height: 1024, channels: 3, background: "#ff00ff" } }).png().toBuffer();
  const logo = await sharp({ create: { width: 80, height: 20, channels: 3, background: "#0000ff" } }).png().toBuffer();
  const brief = makeBrief();
  brief.design = { ...brief.design!, template: "photo-top", alignment: "center" };
  brief.tokens = { ...brief.tokens!, foreground: "#00ff00", accent: "#111111" };
  const output = await renderCreative({ brief, research, tokens: brief.tokens, visualBytes: scene, logoBytes: { bytes: logo, width: 80, height: 20, mime: "image/png" } });
  const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const locations = (matches: (r: number, g: number, b: number) => boolean, maxY: number) => {
    const points: Array<[number, number]> = [];
    for (let y = 0; y < maxY; y++) for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (matches(data[offset], data[offset + 1], data[offset + 2])) points.push([x, y]);
    }
    return points;
  };
  const logoPixels = locations((r, g, b) => b > 240 && r < 15 && g < 15, 80);
  const headlinePixels = locations((r, g, b) => g > 200 && r < 40 && b < 40, 260);
  assert.ok(logoPixels.length > 100);
  assert.equal(Math.min(...logoPixels.map(([x]) => x)), 32);
  assert.equal(Math.min(...logoPixels.map(([, y]) => y)), 24);
  assert.ok(headlinePixels.length > 100);
  assert.ok(Math.max(...headlinePixels.map(([, y]) => y)) < 240, "headline is confined to the top of the ad");
});

test("font fitting retains punctuation and complete offer conditions; overflow and missing glyphs are actionable", async () => {
  const brief = makeBrief();
  brief.headline = "Good grip. Great days. Your case, reimagined.";
  brief.saleId = research.sales[0].id;
  const fitted = await validateCreative(brief, research);
  assert.equal(fitted.headline.lines.join(""), brief.headline);
  assert.equal(fitted.offer!.lines.join(""), source.markdown);
  await assert.rejects(validateCreative({ ...brief, headline: "W".repeat(120) }, research), /Headline does not fit/);
  await assert.rejects(validateCreative({ ...brief, cta: "W".repeat(50) }, research), /CTA does not fit/);
  await assert.rejects(validateCreative({ ...brief, headline: "Hello \u0001" }, research), /unsupported character/);
  const longQuote = source.markdown.repeat(15);
  const longOffer = {
    ...research,
    sales: [{ ...research.sales[0], quote: longQuote }],
    offers: [{ ...research.offers[0], quote: longQuote, displayCopy: longQuote, restrictions: longQuote }],
  };
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

test("small design contract and token resolver constrain model styling", async () => {
  for (const field of ["template", "alignment", "headlineStyle", "ctaStyle"]) assert.equal(designSchema.safeParse({ ...DEFAULT_DESIGN, [field]: "arbitrary-css" }).success, false);
  assert.equal(designSchema.safeParse({ ...DEFAULT_DESIGN, background: { direction: "x".repeat(1001) } }).success, false);
  const tokens = await resolveBrandTokens({ ...research, colors: [{ value: "url(https://example.com)", sourceUrl: source.url }, { value: "#123", sourceUrl: source.url }] });
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
  const counts = { scene: 0, render: 0, review: 0 };
  const fail = { compose: false, scene: false, storage: false, review: false, checkpoint: false };
  const session: Session = { id: randomUUID(), createdAt: "now", updatedAt: "now", preferences: {}, messages: [], events: [], variants: [], research: structuredClone(research) };
  let persisted = structuredClone(session);
  const artistDeps: ArtistDependencies = {
    generateScene: async (source, prompt) => { counts.scene++; assert.equal(source, `saved:${sourceId}`); assert.match(prompt, /ORIGINAL PRODUCT/); assert.match(prompt, /setting/); if (fail.scene) throw new Error("scene timeout"); return { imageUrl: "https://fal.media/scene.png", model: MODEL }; },
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
    save: async current => { if (fail.checkpoint && current.brief?.sceneCheckpoint?.state === "saved") { fail.checkpoint = false; throw new Error("checkpoint failed"); } persisted = structuredClone(current); },
    createAd: (brief, research, execution) => createAd(brief, research, execution, artistDeps),
    reviewAd: async variant => { counts.review++; if (fail.review) { fail.review = false; throw new Error("review failed"); } return { verdict: "pass", checks: codeChecks(variant, bytes.get(variant.id)!), createdAt: "2026-09-22T06:00:00.000Z", visual: { productFidelity: pass, textLegibility: pass, claimAccuracy: pass, brandFit: pass, summary: "TEST FIXTURE ONLY" } }; },
  };
  let workflow = new Workflow(session, deps);
  const approve = async (input = makeBrief()) => { const brief = await workflow.proposeBrief(input); await workflow.approveBrief(brief.id); return brief; };
  const reload = () => workflow = new Workflow(structuredClone(persisted), deps);
  return { get workflow() { return workflow; }, approve, reload, bytes, counts, fail, deps, artistDeps, sourceId };
}

test("one scene stage, exact composition, and revisions reuse only compatible scenes", async () => {
  const h = await harness();
  await h.approve();
  const first = await h.workflow.generate();
  assert.deepEqual(h.counts, { scene: 1, render: 1, review: 1 });
  assert.ok(first.review!.checks.every(check => check.passed));
  assert.equal(first.sourceAssetId, h.sourceId);
  assert.equal((await h.workflow.generate()).id, first.id);
  const revise = (patch: Partial<Brief>) => h.approve({ ...first.brief, parentVariantId: first.id, ...patch });
  const copy = await revise({ headline: "A new headline", design: { ...first.brief.design!, alignment: "center", ctaStyle: "outline" } });
  assert.equal(copy.executionPlan!.scene.action, "reuse");
  const second = await h.workflow.generate();
  assert.equal(second.sceneAssetId, first.sceneAssetId);
  assert.notDeepEqual(h.bytes.get(second.id), h.bytes.get(first.id));
  assert.equal(h.counts.scene, 1, "copy-only makes zero provider calls");
  await revise({ design: { ...first.brief.design!, scene: { ...first.brief.design!.scene, productScale: "large" } } });
  await h.workflow.generate();
  assert.equal(h.counts.scene, 2);
  await revise({ design: { ...first.brief.design!, background: { direction: "A blue tiled bathroom" } } });
  await h.workflow.generate();
  assert.equal(h.counts.scene, 3);
  await revise({ design: { ...first.brief.design!, template: "photo-top" } });
  await h.workflow.generate();
  assert.equal(h.counts.scene, 3, "legacy template choice no longer changes fixed overlay geometry");
  await revise({ variation: "scene" }); await h.workflow.generate();
  assert.equal(h.counts.scene, 4);
  await revise({ variation: "background" }); await h.workflow.generate();
  assert.equal(h.counts.scene, 5, "legacy background variation requests a fresh complete scene");
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
    assert.equal(h.counts.scene, 1, failure);
    assert.equal(h.workflow.session.variants.length, 1);
    assert.equal(h.workflow.session.variants[0].status, "reviewed");
  }
});

test("unknown scene attempts never resubmit; missing reuse and copy overflow fail before spending", async () => {
  const h = await harness();
  await h.approve(); h.fail.scene = true;
  await assert.rejects(h.workflow.generate(), /scene timeout/);
  h.reload(); await assert.rejects(h.workflow.generate(), /already attempted/);
  assert.equal(h.counts.scene, 1);
  const clean = await harness(); await clean.approve(); const first = await clean.workflow.generate();
  const next = await clean.approve({ ...first.brief, parentVariantId: first.id, headline: "Updated copy" });
  clean.bytes.delete(first.sceneAssetId!);
  await assert.rejects(clean.workflow.generate(), /bytes are missing/);
  assert.equal(next.generationAttemptedAt, undefined);
  await assert.rejects(clean.workflow.proposeBrief({ ...first.brief, headline: "W".repeat(120) }), /does not fit/);
  assert.equal(clean.counts.scene, 1);
});

test("reuse keys ignore signed URLs and copy but include source identity, setting, palette and geometry", () => {
  const brief = { ...makeBrief(), sourceAssetId: randomUUID() };
  const plan = planExecution(brief);
  const parent = { id: randomUUID(), sceneAssetId: plan.scene.assetId, sceneAsset: { id: plan.scene.assetId, inputs: { fingerprint: plan.scene.fingerprint } } } as unknown as Variant;
  const revision = { ...brief, parentVariantId: parent.id, referenceImage: "https://cdn.example/image?signature=renewed", headline: "Updated" };
  assert.equal(planExecution(revision, parent).scene.action, "reuse");
  assert.equal(planExecution({ ...revision, sourceAssetId: randomUUID() }, parent).scene.action, "generate");
  assert.equal(planExecution({ ...revision, tokens: { ...brief.tokens!, accent: "#123456" } }, parent).scene.action, "generate");
  assert.equal(planExecution({ ...revision, design: { ...brief.design!, background: { direction: "A new setting" } } }, parent).scene.action, "generate");
  assert.doesNotThrow(() => validatePlan({ ...brief, executionPlan: plan, design: { ...brief.design!, template: "photo-top" } }));
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

test("fal adapter sends one immutable product reference with scene settings", async t => {
  const { generateScene } = await import("../lib/workflow/fal");
  const previous = process.env.FAL_AI_API_KEY; process.env.FAL_AI_API_KEY = "fixture";
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(init.body as string) }); return Response.json({ images: [{ url: "https://fal.media/fixture.png" }], seed: 1 }, { headers: { "x-fal-request-id": "provider-fixture" } }); });
  try {
    const scene = await generateScene("https://storage.example/original", "product scene");
    assert.equal(scene.requestId, "provider-fixture");
    assert.deepEqual(requests[0].body.image_urls, ["https://storage.example/original"]);
    assert.equal(requests[0].body.aspect_ratio, "9:16"); assert.equal(requests[0].body.resolution, "1K");
    assert.throws(() => generateScene("", "prompt"), /saved original product photo/);
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

test("review accepts verified structured product assets absent the page image list and rejects crossed associations", async () => {
  const h = await harness(); await h.approve(); const variant = await h.workflow.generate();
  const saved = structuredClone(variant);
  saved.research.sources[0].images = []; // JSON-LD source photo, not in Firecrawl's separate image list.
  assert.equal(codeChecks(saved, h.bytes.get(saved.id)!).find(check => check.name === "source_photo")!.passed, true);
  saved.research.assets!.find(asset => asset.id === saved.brief.referenceAssetId)!.productIds = ["other-product"];
  assert.equal(codeChecks(saved, h.bytes.get(saved.id)!).find(check => check.name === "source_photo")!.passed, false);
});
