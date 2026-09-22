import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import { assembleResearch } from "../lib/workflow/agents/researcher";
import { artistPrompt, createAd, type ArtistDependencies } from "../lib/workflow/agents/artist";
import { codeChecks } from "../lib/workflow/agents/reviewer";
import { MODEL } from "../lib/workflow/fal";
import { DEFAULT_DESIGN, designSchema } from "../lib/workflow/creative/schema";
import { resolveBrandTokens, readableText } from "../lib/workflow/creative/tokens";
import { validateCreative } from "../lib/workflow/creative/fit";
import { renderCreative } from "../lib/workflow/creative/render";
import { matchesVisual } from "../lib/workflow/creative/reuse";
import { readVisual, readImage, saveVisual, saveComposedGeneration } from "../lib/workflow/storage";
import { createSession, loadSession, saveSession } from "../lib/workflow/sessions";
import type { Brief, Source } from "../lib/workflow/session-types";

const source: Source = { url: "https://store.example/product", images: ["https://store.example/photo.png", "https://store.example/other.png"], title: "A case", description: "A real case", markdown: "Members save 10%. Selected cases only. Ends Friday.", colors: {}, fetchedAt: "now" };
const research = assembleResearch([source], { voice: "Playful", audience: "Inferred", sales: [{ description: "Member offer", quote: source.markdown, sourceUrl: source.url }] });
const makeBrief = (): Brief => ({ id: randomUUID(), researchId: research.id, productUrl: source.url, referenceImage: source.images[0], headline: "Hold on to color", cta: "Shop now", direction: "Overall intent", saleId: null, feedback: "", parentVariantId: null, design: { ...DEFAULT_DESIGN }, tokens: resolveBrandTokens(research) });
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
  await assert.rejects(validateCreative({ ...brief, headline: "Hello 🦖" }, research), /unsupported character/);
  const longOffer = { ...research, sales: [{ ...research.sales[0], quote: source.markdown.repeat(15) }] };
  await assert.rejects(validateCreative(brief, longOffer), /shorter complete source quote/);
  for (const template of ["copy-top", "photo-top"] as const) {
    const output = await renderCreative({ brief: { ...brief, design: { ...brief.design!, template } }, research, tokens: brief.tokens!, visualBytes: png });
    assert.equal(output.readUInt32BE(16), 576);
    assert.equal(output.readUInt32BE(20), 1024);
    assert.ok(output.length > 10000, "The renderer produces a populated PNG");
  }
});

test("small design contract and token resolver constrain model styling", () => {
  for (const field of ["template", "alignment", "headlineStyle", "ctaStyle"]) assert.equal(designSchema.safeParse({ ...DEFAULT_DESIGN, [field]: "arbitrary-css" }).success, false);
  assert.equal(designSchema.safeParse({ ...DEFAULT_DESIGN, visualDirection: "x".repeat(1001) }).success, false);
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

test("one visual, copy-only reuse, checkpoint recovery across reload, and explicit paid revisions", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "hybrid-artist-"));
  const previousDir = process.env.WORKFLOW_DATA_DIR;
  process.env.WORKFLOW_DATA_DIR = directory;
  t.mock.method(globalThis, "fetch", async () => new Response(png));
  let falCalls = 0;
  let composeFailures = 0;
  const artistDeps: ArtistDependencies = {
    generate: async () => { falCalls++; return { imageUrl: "https://fal.media/test.png", model: MODEL, seed: 42 }; },
    saveVisual, readVisual, saveFinal: saveComposedGeneration,
    render: async input => { if (composeFailures-- > 0) throw new Error("Simulated composition failure"); return renderCreative(input); },
  };
  const pass = { status: "pass" as const, reason: "Fixture" };
  const deps: WorkflowDependencies = {
    research: async () => structuredClone(research), readVisual, save: saveSession,
    createAd: (brief, research, execution) => createAd(brief, research, execution, artistDeps),
    reviewAd: async variant => ({ verdict: "pass", checks: codeChecks(variant, (await readImage(variant.id))!), createdAt: "now", visual: { productFidelity: pass, textLegibility: pass, claimAccuracy: pass, brandFit: pass, summary: "Fixture" } }),
  };
  try {
    const session = await createSession();
    const workflow = new Workflow(session, deps);
    await workflow.research({ url: source.url, productUrl: null, campaignUrl: null });
    const first = await workflow.proposeBrief(makeBrief());
    await workflow.approveBrief(first.id);
    const original = await workflow.generate();
    assert.equal(falCalls, 1);
    assert.equal(original.id, first.id);
    assert.ok(original.review!.checks.every(check => check.passed));
    assert.ok(await readVisual(original.visualAssetId!));
    assert.equal((await workflow.generate()).id, original.id);
    assert.equal(falCalls, 1);

    const reuse = { ...makeBrief(), headline: "A new headline", parentVariantId: original.id, design: { ...DEFAULT_DESIGN, template: "photo-top" as const, ctaStyle: "outline" as const, reuseVisualFromVariantId: original.id } };
    const revision = await workflow.proposeBrief(reuse);
    assert.equal(revision.approvedAt, undefined);
    await workflow.approveBrief(revision.id);
    composeFailures = 1;
    await assert.rejects(workflow.generate(), /composition failure/);
    assert.equal(falCalls, 1);
    const reloaded = await loadSession(session.id);
    assert.equal(reloaded.brief!.visualCheckpoint!.id, original.visualAssetId);
    const resumed = new Workflow(reloaded, deps);
    const changed = await resumed.generate(revision.id);
    assert.equal(falCalls, 1);
    assert.equal(changed.visualAssetId, original.visualAssetId);
    assert.notDeepEqual(await readImage(changed.id), await readImage(original.id));
    assert.equal((await resumed.generate()).id, changed.id);
    assert.equal(reloaded.variants.length, 2);

    // Incompatible reuse is never converted into a paid request or marked attempted.
    for (const patch of [
      { referenceImage: source.images[1] },
      { design: { ...reuse.design, visualDirection: "A cream pedestal" } },
      { design: { ...reuse.design, reuseVisualFromVariantId: randomUUID() } },
    ]) {
      const invalid = await resumed.proposeBrief({ ...reuse, ...patch });
      await resumed.approveBrief(invalid.id);
      await assert.rejects(resumed.generate(), /reuse is incompatible/);
      assert.equal(invalid.generationAttemptedAt, undefined);
      assert.equal(falCalls, 1);
    }
    assert.equal(matchesVisual({ ...revision, researchId: "different" }, original.visualAsset!), false);
    assert.equal(matchesVisual({ ...revision, tokens: { ...revision.tokens!, accent: "#123456" } }, original.visualAsset!), false);
    assert.equal(matchesVisual(revision, { ...original.visualAsset!, inputs: { ...original.visualAsset!.inputs, model: "other" } }), false);

    const missing = await resumed.proposeBrief(reuse);
    await resumed.approveBrief(missing.id);
    await assert.rejects(new Workflow(reloaded, { ...deps, readVisual: async () => null }).generate(), /bytes are missing/);
    assert.equal(missing.generationAttemptedAt, undefined);
    assert.equal(falCalls, 1);

    // A new visual is also checkpointed before a failed composition, then recoverable.
    const newBrief = await resumed.proposeBrief({ ...reuse, design: { ...DEFAULT_DESIGN, visualDirection: "A cream pedestal" } });
    await resumed.approveBrief(newBrief.id);
    composeFailures = 1;
    await assert.rejects(resumed.generate(), /composition failure/);
    assert.equal(falCalls, 2);
    const finalWorkflow = new Workflow(await loadSession(session.id), deps);
    const recovered = await finalWorkflow.generate();
    assert.equal(falCalls, 2);
    assert.notEqual(recovered.visualAssetId, original.visualAssetId);
    assert.equal(recovered.id, newBrief.id);

    // Input cannot smuggle an approval, token override, or paid-attempt checkpoint.
    const forged = await finalWorkflow.proposeBrief({ ...reuse, ...{ approvedAt: "fake", visualCheckpoint: original.visualAsset, tokens: { ...revision.tokens!, background: "#000000" } } });
    assert.equal(forged.approvedAt, undefined);
    assert.equal(forged.visualCheckpoint, undefined);
    assert.deepEqual(forged.tokens, resolveBrandTokens(research));
    const invalidText = { ...reuse, headline: "W".repeat(120) };
    await assert.rejects(finalWorkflow.proposeBrief(invalidText), /Headline does not fit/);
    assert.equal(falCalls, 2);

    // Legacy approval never authorizes an added design.
    const legacy = { ...makeBrief(), approvedAt: "old approval" };
    delete legacy.design; delete legacy.tokens;
    finalWorkflow.session.brief = legacy;
    await assert.rejects(finalWorkflow.generate(randomUUID()), /brief changed/);
    assert.equal(finalWorkflow.session.brief.id, legacy.id);
    await assert.rejects(finalWorkflow.generate(), /legacy brief/);
    assert.notEqual(finalWorkflow.session.brief.id, legacy.id);
    assert.equal(finalWorkflow.session.brief.approvedAt, undefined);
    assert.deepEqual(finalWorkflow.session.brief.design, DEFAULT_DESIGN);
    assert.equal(falCalls, 2);
  } finally {
    t.mock.restoreAll();
    if (previousDir === undefined) delete process.env.WORKFLOW_DATA_DIR; else process.env.WORKFLOW_DATA_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  }
});
