import { createHash } from "node:crypto";
import type { Source } from "../session-types";
import type { Evidence, ResearchAsset, ResearchProduct, ResearchV2Fields } from "./contracts";
import { webUrl } from "../validation";
import { shopifyImages, shopifyProductNodes, shopifyVariants } from "./shopify-variants";

export const stableId = (kind: string, value: string) => `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
export function canonicalUrl(value: string) {
  const url = new URL(webUrl(value));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
}
export function productIdentityUrl(value: string) {
  const url = new URL(canonicalUrl(value));
  // Shopify collection links and canonical product links identify the same item.
  url.pathname = url.pathname.replace(/\/collections\/[^/]+\/products\//, "/products/");
  for (const key of ["variant", "selling_plan"]) url.searchParams.delete(key);
  return url.href;
}
export const storeHost = (value: string) => new URL(value).hostname.toLowerCase().replace(/^www\./, "");
export function pageHint(value: string): NonNullable<Source["pageType"]> {
  const path = new URL(value).pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i, "");
  if (!path || path === "/") return "home";
  if (/\/(?:products?|p)\/[^/]+/i.test(path)) return "product";
  if (/\/(?:collections?|categories|campaigns?)\/[^/]+/i.test(path)) return "collection";
  if (/\/(?:pages\/)?(?:about|our-story|reviews|contact)/i.test(path)) return "company";
  return "unknown";
}
export function absolute(value: unknown, base: string): string | null {
  if (typeof value !== "string") return null;
  try { return webUrl(new URL(value.replace(/&amp;/g, "&"), base).href); } catch { return null; }
}
export function assetKey(value: string) {
  const url = new URL(value);
  // Only remove known resizing controls. Version and variant parameters are identity.
  for (const key of ["width", "height", "w", "h", "quality", "format"]) url.searchParams.delete(key);
  return url.href;
}
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
function nodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  const item = object(value);
  return Object.keys(item).length ? [item, ...array(item["@graph"]).flatMap(nodes), ...array(item.mainEntity).flatMap(nodes)] : [];
}
export function structuredNodes(html: string): Json[] {
  const output: Json[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { output.push(...nodes(JSON.parse(match[1]))); } catch { /* Malformed blocks do not invalidate other sources. */ }
  }
  return [...new Map(output.map(node => [JSON.stringify(node), node])).values()];
}
const isType = (node: Json, type: string) => array(node["@type"]).includes(type);
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 4000) : "";
export function extractSource(source: Source): { products: ResearchProduct[]; assets: ResearchAsset[]; customerEvidence: ResearchV2Fields["customerEvidence"] } {
  const structured = structuredNodes(source.rawHtml || "");
  const products: ResearchProduct[] = [];
  const assets = new Map<string, ResearchAsset>();
  const customerEvidence: ResearchV2Fields["customerEvidence"] = [];
  const addAsset = (image: string, role: ResearchAsset["role"], evidence: Evidence, productId?: string) => {
    const id = stableId("asset", assetKey(image));
    const existing = assets.get(id);
    if (existing) {
      const resolution = (url: string) => Number(new URL(url).searchParams.get("width") || new URL(url).searchParams.get("w") || 0);
      if (resolution(image) > resolution(existing.originalUrl)) existing.originalUrl = image;
      if (productId && !existing.productIds.includes(productId)) existing.productIds.push(productId);
      if (productId && existing.role === "unknown") { existing.role = role; existing.evidence = evidence; existing.classification = "verified_structure"; existing.eligibleAsProductReference = true; }
      return id;
    }
    assets.set(id, { id, originalUrl: image, sourceUrl: source.url, role, productIds: productId ? [productId] : [], variantIds: [], evidence,
      classification: productId || role === "logo" ? "verified_structure" : "unresolved", eligibleAsProductReference: !!productId,
      containsMultipleProducts: null, containsPromotionalText: null, width: null, height: null });
    return id;
  };
  for (const node of structured.filter(node => isType(node, "Product") || isType(node, "ProductGroup"))) {
    const declaredOffers = array(node.offers);
    const nodeUrl = absolute(node.url || (declaredOffers.length === 1 ? object(declaredOffers[0]).url : undefined), source.url);
    // A recommendation's Product node never inherits the main page's identity.
    if (nodeUrl && productIdentityUrl(nodeUrl) !== productIdentityUrl(source.finalUrl || source.url)) continue;
    if (!nodeUrl && pageHint(source.url) !== "product") continue;
    const canonical = productIdentityUrl(nodeUrl || source.finalUrl || source.url);
    const productId = stableId("product", canonical);
    const evidence: Evidence = { sourceUrl: source.url, quote: JSON.stringify(node).slice(0, 4000), method: "json_ld", origin: "observed" };
    const images = array(node.image).flatMap(value => { const image = absolute(typeof value === "string" ? value : object(value).url || object(value).contentUrl, source.url); return image ? [image] : []; });
    const assetIds = images.map(image => addAsset(image, "product_photo", evidence, productId));
    const offers = object(array(node.offers)[0]);
    const amount = Number(offers.price);
    const price = offers.price != null && Number.isFinite(amount) && amount >= 0 && typeof offers.priceCurrency === "string" ? { amount, currency: offers.priceCurrency, availability: text(offers.availability) || null } : null;
    const ownVariantUrl = nodeUrl ? new URL(nodeUrl) : null;
    const ownVariantStoreId = ownVariantUrl?.searchParams.get("variant");
    const ownVariantId = ownVariantStoreId ? stableId("variant", `${productId}:${ownVariantStoreId}`) : null;
    if (ownVariantId) for (const assetId of assetIds) assets.get(assetId)!.variantIds.push(ownVariantId);
    const variants = [...array(node.hasVariant), ...declaredOffers.filter(value => object(value).sku).map(value => ({ ...object(value), name: object(value).sku, productID: absolute(object(value).url, source.url) ? new URL(absolute(object(value).url, source.url)!).searchParams.get("variant") : null }))].flatMap(value => {
      const variant = object(value);
      const variantUrl = absolute(variant.url || object(variant.offers).url, source.url);
      if (variantUrl && (new URL(variantUrl).origin !== new URL(canonical).origin || new URL(variantUrl).pathname !== new URL(canonical).pathname)) return [];
      const storeId = text(variant.productID || variant.sku || variant["@id"] || variant.url);
      if (!storeId) return [];
      const id = stableId("variant", `${productId}:${storeId}`);
      const variantAssets = array(variant.image).flatMap(image => { const url = absolute(typeof image === "string" ? image : object(image).url, source.url); if (!url) return []; const assetId = addAsset(url, "product_photo", evidence, productId); assets.get(assetId)!.variantIds.push(id); return [assetId]; });
      return [{ id, storeId, title: text(variant.name), attributes: Object.fromEntries(["color", "size", "pattern"].flatMap(key => typeof variant[key] === "string" ? [[key, variant[key] as string]] : [])), assetIds: variantAssets }];
    });
    if (ownVariantId && ownVariantStoreId) variants.push({ id: ownVariantId, storeId: ownVariantStoreId, title: text(node.name), attributes: typeof node.model === "string" ? { model: node.model } : {}, assetIds });
    products.push({ id: productId, canonicalUrl: canonical, storeId: text(node.productID || node.sku || node["@id"]) || null, title: text(node.name) || source.title, description: text(node.description) || source.description, evidence, assetIds: [...new Set([...assetIds, ...variants.flatMap(v => v.assetIds)])], variants, price });
    const rating = object(node.aggregateRating); const value = Number(rating.ratingValue); const best = Number(rating.bestRating || 5);
    if (rating.ratingValue != null && value >= 0 && value <= best && best > 0) customerEvidence.push({ id: stableId("evidence", `${productId}:rating`), kind: "rating", productId, evidence: { ...evidence, quote: JSON.stringify(rating) }, value: `${value}/${best}`, attribution: null, ratingCount: Number.isInteger(Number(rating.ratingCount)) && rating.ratingCount != null ? Number(rating.ratingCount) : null, reviewCount: Number.isInteger(Number(rating.reviewCount)) && rating.reviewCount != null ? Number(rating.reviewCount) : null, checkedAt: source.fetchedAt });
  }
  const supplemental = source.shopify && (() => {
    try {
      const endpoint = new URL(source.shopify.url), expected = new URL(productIdentityUrl(source.finalUrl || source.url));
      expected.search = ""; expected.pathname += ".js";
      return endpoint.href === expected.href ? [source.shopify.product] : [];
    } catch { return []; }
  })();
  for (const node of [...shopifyProductNodes(source.rawHtml || ""), ...(supplemental || [])]) {
    const declared = node === source.shopify?.product ? source.finalUrl || source.url : absolute(node.url || (typeof node.handle === "string" ? `/products/${node.handle}` : undefined), source.finalUrl || source.url);
    if (!declared || productIdentityUrl(declared) !== productIdentityUrl(source.finalUrl || source.url) || pageHint(declared) !== "product") continue;
    const canonical = productIdentityUrl(declared), productId = stableId("product", canonical);
    const evidence: Evidence = { sourceUrl: node === source.shopify?.product ? source.shopify.url : source.url, quote: JSON.stringify({ id: node.id, handle: node.handle, options: node.options }).slice(0, 4000), method: "shopify", origin: "observed" };
    const assetIds = shopifyImages(node).flatMap(image => { const url = absolute(image, source.url); return url ? [addAsset(url, "product_photo", evidence, productId)] : []; });
    const variants = shopifyVariants(node).map(variant => {
      const id = stableId("variant", `${productId}:${variant.storeId}`);
      const variantEvidence = { ...evidence, quote: JSON.stringify({ productId: node.id, variantId: variant.storeId, attributes: variant.attributes, images: variant.images }).slice(0, 4000) };
      const variantAssets = variant.images.flatMap(image => { const url = absolute(image, source.url); if (!url) return []; const assetId = addAsset(url, "product_photo", variantEvidence, productId); assets.get(assetId)!.variantIds.push(id); assets.get(assetId)!.evidence = variantEvidence; return [assetId]; });
      return { id, storeId: variant.storeId, title: variant.title, attributes: variant.attributes, assetIds: variantAssets };
    });
    products.push({ id: productId, canonicalUrl: canonical, storeId: typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : null, title: text(node.title) || source.title, description: text(node.description) || source.description, evidence, assetIds: [...new Set([...assetIds, ...variants.flatMap(variant => variant.assetIds)])], variants, price: null });
  }
  const brandingImages = object(source.branding?.images);
  const logos = [brandingImages.logo, source.branding?.logo, ...structured.filter(node => isType(node, "Organization")).map(node => typeof node.logo === "string" ? node.logo : object(node.logo).url)];
  for (const logo of logos) { const url = absolute(logo, source.url); if (url) addAsset(url, "logo", { sourceUrl: source.url, quote: url, method: "branding", origin: "observed" }); }
  for (const image of source.images) addAsset(image, "unknown", { sourceUrl: source.url, quote: image, method: "page", origin: "observed" });
  // Shared image membership is valid, but uncertain content still needs human inspection at approval.
  const groupedProducts = new Map<string, ResearchProduct>();
  for (const product of products) {
    const old = groupedProducts.get(product.id);
    groupedProducts.set(product.id, old ? { ...old, title: old.title === product.title ? old.title : source.title,
      assetIds: [...new Set([...old.assetIds, ...product.assetIds])], variants: [...new Map([...old.variants, ...product.variants].map(variant => {
        const previous = old.variants.find(item => item.id === variant.id);
        return [variant.id, previous ? { ...previous, ...variant, attributes: { ...previous.attributes, ...variant.attributes }, assetIds: [...new Set([...previous.assetIds, ...variant.assetIds])] } : variant];
      })).values()] } : product);
  }
  return { products: [...groupedProducts.values()], assets: [...assets.values()].map(asset => ({ ...asset, variantIds: [...new Set(asset.variantIds)] })), customerEvidence: [...new Map(customerEvidence.map(item => [item.id, item])).values()] };
}
