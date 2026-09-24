import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DESIGN, brandTokensSchema, type BrandTokens } from "../lib/workflow/creative/schema";
import { resolveBrandTokens } from "../lib/workflow/creative/tokens";
import { validateCreative } from "../lib/workflow/creative/fit";
import { renderCreative } from "../lib/workflow/creative/render";
import { planExecution } from "../lib/workflow/creative/reuse";
import type { Brief, Research, Variant } from "../lib/workflow/session-types";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=", "base64");
const finding = (value: string | null) => ({ status: value ? "found" as const : "not_found" as const, value });
function researchWithFonts(heading: string | null, body: string | null): Research {
  return {
    id: "research", sources: [], colors: [], voice: "Direct", audience: "Shoppers", sales: [], warnings: [],
    brandKit: {
      id: "brand", revision: 1, canonicalStoreUrl: "https://store.example/", name: "Store", logoAssetIds: [], selectedLogoAssetId: null, colors: [],
      typography: { heading: finding(heading), body: finding(body), renderFont: "geist-fallback", substitution: "fixture" },
      voice: finding(null), audience: finding(null), valueProposition: finding(null), overrides: {},
    },
  };
}
function brief(tokens: BrandTokens): Brief {
  return { id: "brief", researchId: "research", productUrl: "https://store.example/product", referenceImage: "https://store.example/product.png", headline: "A different point of view", cta: "Shop now", direction: "Fixture", saleId: null, feedback: "", parentVariantId: null, design: structuredClone(DEFAULT_DESIGN), tokens };
}

test("store font metadata never causes lookup or download during fitting and rendering", async t => {
  const originalFetch = globalThis.fetch;
  const networkRequests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    // ImageResponse initializes its bundled WASM through a data URL.
    if (String(input).startsWith("data:")) return originalFetch(input);
    networkRequests.push(String(input));
    throw new Error("Unexpected network request");
  });
  const research = researchWithFonts("Abel", "Store Custom Font");
  const tokens = resolveBrandTokens(research);
  assert.equal(tokens.fontId, "geist-fallback");
  assert.equal(research.brandKit?.typography.heading.value, "Abel");
  assert.equal(research.brandKit?.typography.body.value, "Store Custom Font");
  const savedBrief = brief(tokens);
  const fitted = await validateCreative(savedBrief, research);
  const output = await renderCreative({ brief: savedBrief, research, tokens, visualBytes: png });
  assert.equal(fitted.headline.lines.join(""), savedBrief.headline);
  assert.equal(output.readUInt32BE(16), 576);
  assert.equal(output.readUInt32BE(20), 1024);
  assert.deepEqual(networkRequests, []);
});

test("saved custom-font briefs render with bundled Geist and keep reusable scenes", async t => {
  const originalFetch = globalThis.fetch;
  const networkRequests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    // ImageResponse initializes its bundled WASM through a data URL.
    if (String(input).startsWith("data:")) return originalFetch(input);
    networkRequests.push(String(input));
    throw new Error("Unexpected network request");
  });
  const research = researchWithFonts("Abel", null);
  const tokens = resolveBrandTokens(research);
  const legacy = { ...tokens, fontId: "fontsource" as const, sourceId: "abel", family: "Abel", weight: 400, style: "normal", format: "ttf", version: "5.3.0", fileUrl: "https://cdn.example/old-font.ttf" };
  assert.equal(brandTokensSchema.safeParse(legacy).success, true);
  const savedBrief = brief(legacy);
  const output = await renderCreative({ brief: savedBrief, research, tokens: legacy, visualBytes: png });
  const geistBrief = brief(tokens);
  const geistOutput = await renderCreative({ brief: geistBrief, research, tokens, visualBytes: png });
  assert.deepEqual(output, geistOutput);
  savedBrief.sourceAssetId = "source";
  const plan = planExecution(savedBrief);
  const parent = { id: "parent", sceneAssetId: plan.scene.assetId, sceneAsset: { id: plan.scene.assetId, inputs: { fingerprint: plan.scene.fingerprint } } } as unknown as Variant;
  assert.equal(planExecution({ ...savedBrief, tokens, parentVariantId: parent.id }, parent).scene.action, "reuse");
  assert.deepEqual(networkRequests, []);
});
