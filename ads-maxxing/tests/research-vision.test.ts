import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAssessments, classifyResearchAssets, CLASSIFICATION_PROMPT } from "../lib/workflow/research/vision";
import type { ResearchAsset } from "../lib/workflow/research/contracts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=", "base64");
const asset = (id: string, known = false): ResearchAsset => ({ id, originalUrl: `https://store.example/${id}.png`, sourceUrl: "https://store.example/products/case", role: known ? "product_photo" : "unknown", productIds: known ? ["product"] : [], variantIds: [], evidence: { sourceUrl: "https://store.example/products/case", quote: "Image in product data", method: known ? "json_ld" : "page", origin: "observed" }, classification: known ? "verified_structure" : "unresolved", eligibleAsProductReference: known, containsMultipleProducts: null, containsPromotionalText: null, width: null, height: null });
const photo = (assetId: string) => ({ assetId, role: "product_photo" as const, containsMultipleProducts: false, containsPromotionalText: false, uncertain: false, reason: "One complete product on a clean surface" });

test("vision role cannot grant ownership, invent IDs or override owner corrections", () => {
  const unknown = asset("unknown"); const known = asset("known", true); const corrected = { ...asset("owner", true), classification: "user_confirmed" as const };
  const output = applyAssessments([unknown, known, corrected], [photo("unknown"), photo("known"), { ...photo("owner"), role: "promotion_graphic" }, photo("invented")], new Set(["unknown", "known", "owner"]), "now");
  assert.equal(output[0].role, "product_photo"); assert.equal(output[0].eligibleAsProductReference, false); assert.deepEqual(output[0].productIds, []);
  assert.equal(output[1].eligibleAsProductReference, true); assert.deepEqual(output[1].productIds, ["product"]); assert.equal(output[1].visualAssessment?.origin, "inferred");
  assert.deepEqual(output[2], corrected); assert.equal(output.length, 3);
});

test("promotional overlays, collages and uncertainty demote eligibility without changing observed identity", () => {
  for (const assessment of [{ ...photo("known"), containsPromotionalText: true }, { ...photo("known"), containsMultipleProducts: true }, { ...photo("known"), uncertain: true }, { ...photo("known"), role: "icon" as const }]) {
    const output = applyAssessments([asset("known", true)], [assessment], new Set(["known"]), "now")[0];
    assert.equal(output.eligibleAsProductReference, false); assert.deepEqual(output.productIds, ["product"]); assert.equal(output.evidence.origin, "observed");
  }
  assert.match(CLASSIFICATION_PROMPT, /physically present on the product/);
});

test("vision caps six image downloads, three concurrent, bytes and one classification call", async () => {
  let active = 0, peak = 0, downloads = 0, modelCalls = 0;
  const inputs = Array.from({ length: 12 }, (_, index) => asset(`asset${index}`, index === 0));
  const result = await classifyResearchAssets(inputs, [], Date.now() + 120000, {
    now: Date.now,
    download: async (_url, limits) => { downloads++; active++; peak = Math.max(peak, active); assert.ok(limits.maxBytes <= 1200000); assert.ok(limits.timeoutMs <= 10000); await new Promise(resolve => setTimeout(resolve, 1)); active--; return png; },
    classify: async messages => { modelCalls++; assert.equal(messages.length, 1); const content = messages[0].content; assert.ok(Array.isArray(content)); assert.equal(content.length, 12); return { assessments: [photo("asset0"), photo("invented")] }; },
  });
  assert.equal(downloads, 6); assert.ok(peak <= 3); assert.equal(modelCalls, 1); assert.equal(result.assets[0].width, 1); assert.match(result.warnings.join(" "), /invented/);
});

test("download/model failure preserves findings and deadline prevents optional spending", async () => {
  const inputs = [asset("known", true), asset("unknown")]; let calls = 0;
  const deps = { now: Date.now, download: async () => png, classify: async () => { calls++; throw new Error("unavailable"); } };
  const failed = await classifyResearchAssets(inputs, [], Date.now() + 120000, deps);
  assert.deepEqual(failed.assets, inputs); assert.match(failed.warnings.join(" "), /unavailable/);
  await classifyResearchAssets(inputs, [], Date.now() + 20000, deps); assert.equal(calls, 1);
  const oversize = await classifyResearchAssets(inputs, [], Date.now() + 120000, { ...deps, download: async () => Buffer.alloc(1200001) });
  assert.deepEqual(oversize.assets, inputs); assert.equal(calls, 1); assert.ok(oversize.warnings.length);
});
