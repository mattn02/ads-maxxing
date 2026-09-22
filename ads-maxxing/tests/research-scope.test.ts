import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { extractSource } from "../lib/workflow/research/extract";
import { createCampaignScope, deviceTarget, matchingDeviceMembers, memberReferenceReadiness, scopeForCampaign } from "../lib/workflow/research/scope";
import { research } from "../lib/workflow/agents/researcher";
import { groundBrief } from "../lib/workflow/research/grounding";
import type { Source } from "../lib/workflow/session-types";

const home = "https://store.example/";
function page(handle: string, specificPhotos = true): Source {
  const product = { id: handle, handle, title: handle, options: [{ name: "Phone Model" }, { name: "Hand" }], images: ["/shared.jpg", { id: 10, src: `/${handle}-pro.jpg` }], variants: [
    { id: 101, title: "iPhone 18 Pro / Right", option1: "iPhone 18 Pro", option2: "Right", ...(specificPhotos ? { image_id: 10 } : {}) },
    { id: 102, title: "iPhone 18 Pro Max / Right", options: ["iPhone 18 Pro Max", "Right"] },
    { id: 103, title: "iPhone 17 Pro / Right", option1: "iPhone 17 Pro", option2: "Right" },
  ] };
  return { url: `${home}products/${handle}`, title: handle, description: "Cases", markdown: "Cases", fetchedAt: "now", colors: {}, images: [], rawHtml: `<script type="application/json">${JSON.stringify({ product })}</script>` };
}

test("Shopify options enrich actual variants while generic product images never become variant evidence", () => {
  const found = extractSource(page("pink")), product = found.products[0];
  assert.equal(product.variants.length, 3);
  assert.equal(product.variants[0].attributes["Phone Model"], "iPhone 18 Pro");
  assert.equal(product.variants[0].attributes.Hand, "Right");
  const exact = matchingDeviceMembers(found.products, deviceTarget("Promote iPhone18 Pro")!);
  assert.deepEqual(exact, [{ productId: product.id, variantId: product.variants[0].id }]);
  assert.equal(matchingDeviceMembers(found.products, deviceTarget("iPhone 18 ProMax")!).length, 1);
  assert.equal(matchingDeviceMembers(found.products, deviceTarget("all iPhone 18")!).length, 2);
  assert.equal(memberReferenceReadiness(exact[0], found.products, found.assets).status, "ready");
  const max = { productId: product.id, variantId: product.variants[1].id };
  assert.equal(memberReferenceReadiness(max, found.products, found.assets).status, "needs_reference");
  assert.equal(found.assets.find(asset => asset.originalUrl.endsWith("shared.jpg"))!.variantIds.length, 0);
});

test("matching keeps all discovered products, and active target/legacy selection never broadens scope", () => {
  const products = [extractSource(page("pink")), extractSource(page("blue"))].flatMap(found => found.products);
  const members = matchingDeviceMembers(products, { generation: 18 });
  assert.equal(members.length, 4);
  const scope = createCampaignScope(products, members, [`${home}collections/iphone-18`]);
  assert.equal(scope.coverage.status, "partial");
  assert.equal(scopeForCampaign({ scope, selectedProductId: products[1].id }, products).members.length, 4);
  assert.deepEqual(scopeForCampaign({ selectedProductId: products[0].id }, products).members, [{ productId: products[0].id, variantId: null }]);
  assert.equal(scopeForCampaign({ selectedProductId: null }, products).members.length, 0);
  assert.throws(() => createCampaignScope(products, [{ productId: products[0].id, variantId: "invented" }]), /actual variant/);
});

test("combined explicit phone options match every named device without confusing Pro and Pro Max", () => {
  const found = extractSource(page("pink"));
  found.products[0].variants = [{ ...found.products[0].variants[0], attributes: { Model: "iPhone17Pro / iPhone18Pro" } }];
  assert.equal(matchingDeviceMembers(found.products, { generation: 18, model: "pro" }).length, 1);
  assert.equal(matchingDeviceMembers(found.products, { generation: 17, model: "pro" }).length, 1);
  assert.equal(matchingDeviceMembers(found.products, { generation: 18, model: "pro max" }).length, 0);
});

test("existing Loopy SKU-only fixture stays unknown for device and variant-photo matching", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/research-five-stores.json", import.meta.url), "utf8")) as { store: string; source: Source }[];
  const found = extractSource(fixtures.find(fixture => fixture.store === "www.loopycases.com")!.source);
  assert.equal(found.products[0].variants.length, 27);
  assert.deepEqual(matchingDeviceMembers(found.products, { generation: 18 }), []);
  assert.ok(found.products[0].variants.every(variant => !variant.assetIds.length));
});

test("unrelated embedded product JSON cannot claim this page or lend its photos", () => {
  const source = page("pink"); source.rawHtml = (source.rawHtml || "") + (page("blue").rawHtml || "");
  const found = extractSource(source);
  assert.equal(found.products.length, 1);
  assert.ok(found.assets.every(asset => !asset.originalUrl.includes("blue-pro")));
});

test("research direction changes retain catalog facts but exclude previous members and preserve multiple current matches", async () => {
  const collection = `${home}collections/iphone-18`;
  const deps = { now: Date.now, discover: async () => [], synthesize: async () => ({ voice: "Friendly", audience: "People", sales: [] }), scrape: async (url: string): Promise<Source> => {
    if (url === collection) return { ...page("none"), url, rawHtml: "", links: [page("pink").url, page("blue").url] };
    if (url === home) return { ...page("none"), url, rawHtml: "", links: [] };
    return page(new URL(url).pathname.split("/").at(-1)!);
  } };
  const oldUrl = page("old").url;
  const previous = await research({ url: oldUrl, productUrl: null, campaignUrl: null }, { direction: { text: oldUrl, origin: "specific_url", url: oldUrl } }, deps);
  const oldId = previous.products![0].id;
  const current = await research({ url: collection, productUrl: null, campaignUrl: null }, { previous, direction: { text: "Promote all iPhone 18", origin: "specific_url", url: collection } }, deps);
  assert.ok(current.products!.some(product => product.id === oldId), "previous facts remain in known catalog");
  assert.equal(current.campaign!.scope!.members.length, 4);
  assert.ok(current.campaign!.scope!.members.every(member => member.productId !== oldId));
  assert.equal(current.campaign!.productIds.length, 2);
  assert.equal(current.campaign!.scope!.coverage.foundProductIds.length, 2);
  assert.equal(current.campaign!.scope!.coverage.status, "partial");
  const product = current.products!.find(product => product.id === current.campaign!.productIds[0])!;
  current.campaign!.selectedProductId = product.id;
  const pro = product.variants.find(variant => variant.attributes["Phone Model"] === "iPhone 18 Pro")!;
  const asset = current.assets!.find(asset => asset.id === pro.assetIds[0])!;
  const brief = { productId: product.id, variantId: pro.id, referenceAssetId: asset.id, productUrl: product.canonicalUrl, referenceImage: asset.originalUrl, headline: "Keep a good grip", cta: "Shop now", direction: "Phone cases", saleId: null, parentVariantId: null, feedback: "" };
  groundBrief(brief, current);
  assert.throws(() => groundBrief({ ...brief, variantId: product.variants.find(variant => variant.attributes["Phone Model"] === "iPhone 17 Pro")!.id }, current), /included campaign/);
  assert.throws(() => groundBrief({ ...brief, variantId: null }, current), /included campaign/);
});
