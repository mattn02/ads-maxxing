import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_DESIGN, brandTokensSchema, type BrandTokens } from "../lib/workflow/creative/schema";
import { assertCreativeFontCompatible, clearFontCachesForTests, normalizeObservedFamilies, resolveBrandFont } from "../lib/workflow/creative/fonts";
import { resolveBrandTokens } from "../lib/workflow/creative/tokens";
import { validateCreative } from "../lib/workflow/creative/fit";
import { renderCreative } from "../lib/workflow/creative/render";
import { planExecution } from "../lib/workflow/creative/reuse";
import type { Brief, Research, Variant } from "../lib/workflow/session-types";

const geistBytes = readFileSync(path.join(process.cwd(), "assets/fonts/Geist-Regular.ttf"));
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
function responseFor(sourceId: string, family: string, version = "5.3.0") {
  return {
    id: sourceId, family, subsets: ["latin"], weights: [400], styles: ["normal"], defSubset: "latin", variable: false,
    lastModified: "2026-01-01", category: "sans-serif", version: "v1", type: "google", npmVersion: version,
    variants: { "400": { normal: { latin: { url: {
      woff: `https://cdn.jsdelivr.net/fontsource/fonts/${sourceId}@latest/latin-400-normal.woff`,
      ttf: `https://cdn.jsdelivr.net/fontsource/fonts/${sourceId}@latest/latin-400-normal.ttf`,
    } } } } },
  };
}
const fontResponse = () => new Response(new Uint8Array(geistBytes), { status: 200, headers: { "content-type": "font/ttf" } });
function brief(tokens: BrandTokens): Brief {
  return { id: "brief", researchId: "research", productUrl: "https://store.example/product", referenceImage: "https://store.example/product.png", headline: "A different point of view", cta: "Shop now", direction: "Fixture", saleId: null, feedback: "", parentVariantId: null, design: structuredClone(DEFAULT_DESIGN), tokens };
}

test("font names normalize CSS lists and exact supported heading families are pinned", async () => {
  clearFontCachesForTests();
  assert.deepEqual(normalizeObservedFamilies(`font-family:  "Abel" , system-ui, sans-serif`), ["Abel"]);
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/v1/fonts/abel")) return Response.json(responseFor("abel", "Abel"));
    if (url === "https://cdn.jsdelivr.net/fontsource/fonts/abel@5.3.0/latin-400-normal.ttf") return fontResponse();
    return new Response("missing", { status: 404 });
  };
  const selection = await resolveBrandFont(` "Abel", sans-serif`, "Body Font", fetcher as typeof fetch);
  assert.deepEqual(selection, { fontId: "fontsource", sourceId: "abel", family: "Abel", weight: 400, style: "normal", format: "ttf", version: "5.3.0", fileUrl: "https://cdn.jsdelivr.net/fontsource/fonts/abel@5.3.0/latin-400-normal.ttf" });
  assert.equal(calls.some(url => url.includes("body-font")), false, "a supported heading wins before body lookup");
  assert.equal(calls.some(url => url.includes("@latest")), false, "font downloads use the pinned package version");
});

test("body family is tried after an unavailable heading", async () => {
  clearFontCachesForTests();
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/v1/fonts/abel")) return Response.json(responseFor("abel", "Abel"));
    if (url.includes("/fontsource/fonts/abel@5.3.0/")) return fontResponse();
    return new Response("missing", { status: 404 });
  };
  const selection = await resolveBrandFont("Unavailable Display", "Abel", fetcher as typeof fetch);
  assert.equal(selection.fontId, "fontsource");
  assert.deepEqual(calls.slice(0, 2).map(url => new URL(url).pathname), ["/v1/fonts/unavailable-display", "/v1/fonts/abel"]);
});

test("unknown families, mismatches, and failed downloads select Geist before approval", async () => {
  for (const mode of ["unknown", "mismatch", "download"] as const) {
    clearFontCachesForTests();
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1/fonts/")) {
        if (mode === "unknown") return new Response("missing", { status: 404 });
        return Response.json(responseFor("pretend", mode === "mismatch" ? "Another Family" : "Pretend"));
      }
      return new Response("unavailable", { status: 503 });
    };
    const tokens = await resolveBrandTokens(researchWithFonts("Pretend", null), fetcher as typeof fetch);
    assert.equal(tokens.fontId, "geist-fallback", mode);
  }
});

test("legacy Geist tokens stay valid", () => {
  assert.equal(brandTokensSchema.safeParse({ background: "#ffffff", foreground: "#000000", accent: "#111111", ctaForeground: "#ffffff", fontId: "geist-fallback" }).success, true);
});

test("parseable fonts with unsupported shaping are rejected before approval", () => {
  const incompatible = { getAdvanceWidth() { throw new Error("substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported"); } };
  assert.throws(() => assertCreativeFontCompatible(incompatible), /substitutionType : 62/);
});

test("fitting and ImageResponse rendering share the saved custom font", async t => {
  clearFontCachesForTests();
  let fileDownloads = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/fonts/abel")) return Response.json(responseFor("abel", "Abel"));
    if (url.includes("/fontsource/fonts/abel@5.3.0/")) { fileDownloads++; return fontResponse(); }
    return new Response("missing", { status: 404 });
  });
  const research = researchWithFonts("Abel", null);
  const tokens = await resolveBrandTokens(research);
  assert.equal(tokens.fontId, "fontsource");
  const savedBrief = brief(tokens);
  const fitted = await validateCreative(savedBrief, research);
  const output = await renderCreative({ brief: savedBrief, research, tokens, visualBytes: png });
  assert.equal(fitted.headline.lines.join(""), savedBrief.headline);
  assert.equal(output.readUInt32BE(16), 576);
  assert.equal(fileDownloads, 1, "selection, fitting, and rendering reuse the same parsed font bytes");
});

test("an approved custom selection never silently substitutes Geist", async t => {
  clearFontCachesForTests();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("font CDN offline"); });
  const tokens: BrandTokens = { background: "#ffffff", foreground: "#000000", accent: "#111111", ctaForeground: "#ffffff", fontId: "fontsource", sourceId: "abel", family: "Abel", weight: 400, style: "normal", format: "ttf", version: "5.3.0", fileUrl: "https://cdn.jsdelivr.net/fontsource/fonts/abel@5.3.0/latin-400-normal.ttf" };
  await assert.rejects(validateCreative(brief(tokens), researchWithFonts("Abel", null)), error => {
    assert.match((error as Error).message, /approved Abel font could not be loaded or shaped/);
    assert.doesNotMatch((error as Error).message, /headline:|cta:/);
    return true;
  });
});

test("a font-only revision reuses its compatible paid scene", () => {
  const geist = brief({ background: "#ffffff", foreground: "#000000", accent: "#111111", ctaForeground: "#ffffff", fontId: "geist-fallback" });
  geist.sourceAssetId = "source";
  const plan = planExecution(geist);
  const parent = { id: "parent", sceneAssetId: plan.scene.assetId, sceneAsset: { id: plan.scene.assetId, inputs: { fingerprint: plan.scene.fingerprint } } } as unknown as Variant;
  const custom: BrandTokens = { ...geist.tokens!, fontId: "fontsource", sourceId: "abel", family: "Abel", weight: 400, style: "normal", format: "ttf", version: "5.3.0", fileUrl: "https://cdn.jsdelivr.net/fontsource/fonts/abel@5.3.0/latin-400-normal.ttf" };
  assert.equal(planExecution({ ...geist, tokens: custom, parentVariantId: parent.id }, parent).scene.action, "reuse");
});
