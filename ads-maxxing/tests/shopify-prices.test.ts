import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchShopifyProductSource, compactShopifySource } from "../lib/workflow/research/shopify-fetch";
import { extractSource } from "../lib/workflow/research/extract";
import { productSchema } from "../lib/workflow/research/contracts";
import { formatProductPrice, selectedProductPrice, shopifyPrice, shopifyProductPrice } from "../lib/workflow/research/prices";
import { formatResearchedPrice } from "../lib/workflow/creative/fit";
import type { Brief, Research } from "../lib/workflow/session-types";

const url = "https://store.example/fr/products/shirt?variant=12";
const product = { id: 1, handle: "shirt", title: "Shirt", options: ["Size"], images: ["/shirt.jpg"], price: 1995, price_min: 1995, price_max: 2995, available: true, variants: [
  { id: 11, title: "Small", options: ["Small"], price: 1995, compare_at_price: 2495, available: false },
  { id: 12, title: "Large", options: ["Large"], price: 2995, compare_at_price: null, available: true },
] };

test("Shopify prices survive fetch, compaction, persistence and selected-variant ad formatting", async () => {
  const calls: string[] = [];
  const source = await fetchShopifyProductSource(url, {}, async (endpoint, context) => {
    calls.push(endpoint);
    if (endpoint.endsWith("shirt.js")) {
      context?.onCookies?.(["localization=CA; Path=/; Secure", "cart_currency=CAD; Path=/"]);
      return product;
    }
    assert.equal(endpoint, "https://store.example/fr/cart.js");
    assert.equal(context?.cookie, "localization=CA; cart_currency=CAD");
    return { currency: "CAD", token: "must-not-persist", items: [] };
  });
  assert.equal(calls.length, 2);
  assert.equal(source.shopify?.currency?.code, "CAD");
  assert.ok(!JSON.stringify(source).includes("must-not-persist"));
  assert.ok(!JSON.stringify(source).includes("localization=CA"));
  const saved = productSchema.parse(JSON.parse(JSON.stringify(extractSource(compactShopifySource(source)).products[0])));
  assert.equal(saved.price?.amount, 19.95);
  assert.equal(saved.price?.maxAmount, 29.95);
  assert.equal(formatProductPrice(saved.price!), "From CA$19.95");
  assert.equal(saved.variants[0].price?.compareAtAmount, 24.95);
  assert.equal(saved.variants[0].price?.availability, "OutOfStock");
  assert.equal(saved.variants[1].price?.amount, 29.95);
  const research = { products: [saved] } as Research;
  assert.equal(formatResearchedPrice({ productId: saved.id, variantId: saved.variants[1].id } as Brief, research), "CA$29.95");
  assert.equal(formatResearchedPrice({ productId: saved.id } as Brief, research), "From CA$19.95");
  assert.equal(selectedProductPrice(saved, "unknown"), null);
});

test("unavailable or malformed currency preserves photos and raw prices without inventing a currency", async () => {
  for (const cart of [() => { throw new Error("timeout"); }, () => ({}), () => ({ currency: "US dollars" })]) {
    const source = await fetchShopifyProductSource(url, {}, async endpoint => endpoint.endsWith("shirt.js") ? product : cart());
    const found = extractSource(source);
    assert.ok(found.assets.length);
    assert.equal(found.products[0].price, null);
    assert.ok(found.products[0].variants.every(variant => variant.price === null));
    assert.equal(source.shopify?.product.price, 1995);
  }
});

test("Shopify money handles zero and JPY, rejects malformed amounts, and never substitutes another variant", async () => {
  assert.equal(shopifyPrice({ price: 0, compare_at_price: 100 }, "USD")?.amount, 0);
  assert.equal(shopifyPrice({ price: 100000 }, "JPY")?.amount, 1000);
  for (const price of [null, undefined, "1995", -1, NaN, Infinity, 1.5]) assert.equal(shopifyPrice({ price }, "USD"), null);
  assert.equal(shopifyProductPrice({ variants: [null, { price: 100 }] }, "USD"), null);
  const source = await fetchShopifyProductSource(url, {}, async endpoint => endpoint.endsWith("shirt.js") ? product : { currency: "USD" });
  const saved = extractSource(source).products[0];
  saved.variants[1].price = null;
  assert.equal(selectedProductPrice(saved, saved.variants[1].id), null);
  // Existing snapshots remain readable; their existing product-level price is retained.
  delete saved.variants[0].price;
  assert.deepEqual(selectedProductPrice(productSchema.parse(saved), saved.variants[0].id), saved.price);
});
