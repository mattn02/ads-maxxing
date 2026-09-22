import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fetchShopifyProductSource, readShopifyProduct } from "../lib/workflow/research/shopify-fetch";
import { extractSource } from "../lib/workflow/research/extract";
import { matchingDeviceMembers, memberReferenceReadiness } from "../lib/workflow/research/scope";
import type { Source } from "../lib/workflow/session-types";

const source = (url = "https://apparel.example/products/linen-shirt"): Source => ({ url, title: "Linen shirt", description: "Lightweight linen", markdown: "Linen shirt", colors: {}, images: [], rawHtml: '<script src="https://cdn.shopify.com/theme.js"></script>', fetchedAt: "now" });
const shirt = { id: 1, handle: "linen-shirt", title: "Linen shirt", options: ["Size", "Color"], images: ["/linen.jpg"], variants: [
  { id: 11, title: "Small / Blue", options: ["Small", "Blue"], featured_image: { src: "/linen-blue.jpg" } },
  { id: 12, title: "Large / White", option1: "Large", option2: "White" },
] };

test("generic Shopify primary source preserves explicit size/color and endpoint provenance with one bounded read", async () => {
  let calls = 0;
  const enriched = await fetchShopifyProductSource(source().url, {}, async url => { calls++; assert.equal(url, "https://apparel.example/products/linen-shirt.js"); return shirt; });
  assert.equal(calls, 1);
  assert.equal(enriched.rawHtml, undefined, "Primary data requires no storefront HTML");
  const found = extractSource(enriched), product = found.products[0];
  assert.deepEqual(product.variants[0].attributes, { Size: "Small", Color: "Blue" });
  assert.equal(product.variants[1].assetIds.length, 0);
  assert.equal(product.evidence.sourceUrl, enriched.shopify!.url);
  assert.equal(found.assets.find(asset => asset.variantIds.length)!.evidence.sourceUrl, enriched.shopify!.url);
  assert.deepEqual(matchingDeviceMembers(found.products, { generation: 18 }), []);
});

test("primary extraction rejects foreign endpoint evidence and network reader rejects private endpoints", async () => {
  const original = source();
  const foreign = { ...original, shopify: { url: "https://other.example/products/linen-shirt.js", fetchedAt: "now", product: shirt } };
  assert.equal(extractSource(foreign).products.length, 0);
  await assert.rejects(readShopifyProduct("https://127.0.0.1/products/shirt.js"), /public network/);
  await assert.rejects(readShopifyProduct("http://apparel.example/products/shirt.js"), /Unsafe/);
});

test("real public product JSON supplies four iPhone18 members with explicit variant references", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/shopify-public-product.json", import.meta.url), "utf8")) as NonNullable<Source["shopify"]>;
  const page = { ...source(fixture.url.replace(/\.js$/, "")), shopify: fixture };
  const found = extractSource(page), members = matchingDeviceMembers(found.products, { generation: 18 });
  assert.equal(found.products[0].variants.length, 41);
  assert.equal(members.length, 4);
  assert.equal(matchingDeviceMembers(found.products, { generation: 18, model: "pro" }).length, 2);
  assert.equal(matchingDeviceMembers(found.products, { generation: 18, model: "pro max" }).length, 2);
  assert.ok(members.every(member => memberReferenceReadiness(member, found.products, found.assets).status === "ready"));
  assert.ok(members.every(member => found.products[0].variants.find(variant => variant.id === member.variantId)!.attributes["Phone Type"].includes("iPhone 18")));
});

test("primary Shopify source is compact, locale-aware and preserves generic options without HTML or model work", async () => {
  const { fetchShopifyProductSource, compactShopifySource, isShopifySource } = await import("../lib/workflow/research/shopify-fetch");
  let calls = 0;
  const page = await fetchShopifyProductSource("https://apparel.example/fr/products/linen-shirt?variant=11", {}, async url => {
    calls++; assert.equal(url, "https://apparel.example/fr/products/linen-shirt.js");
    return { ...shirt, description: "<p>Lightweight &amp; breathable.</p>", unnecessary: "x".repeat(10000) };
  });
  assert.equal(calls, 1); assert.equal(page.rawHtml, undefined); assert.ok(isShopifySource(page));
  assert.equal(page.description, "Lightweight & breathable.");
  const found = extractSource(page);
  assert.equal(found.products.length, 1);
  assert.equal(found.products[0].canonicalUrl, "https://apparel.example/fr/products/linen-shirt");
  assert.deepEqual(found.products[0].variants[0].attributes, { Size: "Small", Color: "Blue" });
  assert.equal(found.products[0].variants[1].assetIds.length, 0);
  assert.ok(JSON.stringify(page).length < 2500);
  const old = { ...page, rawHtml: "x".repeat(10000) };
  const compact = compactShopifySource(old);
  assert.equal(old.rawHtml.length, 10000); assert.equal(compact.rawHtml, undefined);
  assert.deepEqual(extractSource(compact), found);
});

test("primary source distinguishes unsupported platform from temporary Shopify API failure", async () => {
  const { fetchShopifyProductSource, ShopifyProductError } = await import("../lib/workflow/research/shopify-fetch");
  const unavailable = async () => { throw new ShopifyProductError("404", "unsupported"); };
  await assert.rejects(fetchShopifyProductSource(source().url, {}, unavailable), /supports Shopify/);
  await assert.rejects(fetchShopifyProductSource(source().url, { shopifyKnown: true }, unavailable), /currently unavailable/);
  await assert.rejects(fetchShopifyProductSource(source().url, {}, async () => { throw new Error("timeout"); }), /currently unavailable/);
});

test("Shopify research reads discovered products through API and keeps only explicit associations", async () => {
  const { research } = await import("../lib/workflow/agents/researcher");
  const home = "https://apparel.example/";
  let productCalls = 0, htmlCalls = 0;
  const result = await research({ url: source().url, productUrl: null, campaignUrl: null }, { direction: { text: "Promote linen shirt", origin: "specific_url", url: source().url } }, {
    shopifyOnly: true, now: Date.now, discover: async () => [],
    synthesize: async () => ({ voice: "unknown", audience: "unknown", sales: [] }),
    scrape: async url => { htmlCalls++; assert.equal(url, home); return { ...source(home), links: [source().url] }; },
    productSource: async url => { productCalls++; return fetchShopifyProductSource(url, {}, async () => shirt); },
  });
  assert.equal(productCalls, 1); assert.equal(htmlCalls, 1);
  assert.equal(result.products!.length, 1); assert.equal(result.campaign!.scope!.members.length, 1);
  assert.equal(result.sources.find(item => item.pageType === "product")!.rawHtml, undefined);
  assert.ok(result.products![0].variants[1].assetIds.length === 0);
});
