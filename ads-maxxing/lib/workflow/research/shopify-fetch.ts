import { lookup } from "node:dns/promises";
import https from "node:https";
import type { Source } from "../session-types";
import { publicAddress } from "../asset-download";
import { productIdentityUrl } from "./extract";
import { MAX_RESEARCH_ASSETS } from "./limits";
import { WorkflowError } from "../validation";

const MAX_BYTES = 512_000;
export class ShopifyProductError extends Error {
  constructor(message: string, public kind: "unsupported" | "unavailable") { super(message); }
}
/** One bounded, DNS-pinned public read; redirects cannot change the store or selected product. */
export async function readShopifyProduct(input: string): Promise<Record<string, unknown>> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("Unsafe product endpoint");
  const signal = AbortSignal.timeout(10000);
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  ]);
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error("Product endpoint is not on a public network");
  const address = addresses[0];
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const options: import("node:http").RequestOptions & { autoSelectFamily: boolean } = { autoSelectFamily: false, signal, headers: { Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": "node" }, lookup: (_host, _options, callback) => callback(null, address.address, address.family) };
    const request = https.get(url, options, resolve);
    request.on("error", reject);
  });
  if (response.statusCode !== 200 || Number(response.headers["content-length"] || 0) > MAX_BYTES) { response.destroy(); throw new ShopifyProductError("Product JSON unavailable or too large", response.statusCode === 404 ? "unsupported" : "unavailable"); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > MAX_BYTES) { response.destroy(); throw new Error("Product JSON exceeds size limit"); }
    chunks.push(bytes);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ShopifyProductError("Invalid product JSON", "unsupported"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShopifyProductError("Invalid product JSON", "unsupported");
  return value as Record<string, unknown>;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const plainText = (value: unknown) => typeof value === "string" ? value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 8000) : "";
function compactProduct(product: Record<string, unknown>) {
  const image = (value: unknown) => typeof value === "string" ? value : Object.fromEntries(["id", "src", "url", "variant_ids"].filter(key => record(value)[key] !== undefined).map(key => [key, record(value)[key]]));
  return {
    id: product.id, handle: product.handle, title: plainText(product.title), description: plainText(product.description), options: product.options,
    images: Array.isArray(product.images) ? product.images.slice(0, MAX_RESEARCH_ASSETS).map(image) : [], featured_image: image(product.featured_image),
    variants: Array.isArray(product.variants) ? product.variants.map(value => {
      const variant = record(value);
      return { ...Object.fromEntries(["id", "title", "options", "option1", "option2", "option3", "image_id", "available"].filter(key => variant[key] !== undefined).map(key => [key, variant[key]])), featured_image: image(variant.featured_image), featured_media: { preview_image: image(record(variant.featured_media).preview_image) } };
    }) : [],
  };
}
export function isShopifySource(source: Source): boolean {
  return !!source.shopify && Array.isArray(source.shopify.product.variants) && Array.isArray(source.shopify.product.options)
    || /cdn\.shopify\.com|myshopify\.com|shopify-section|\bShopify\s*[.=]/i.test(source.rawHtml || "");
}

/** Preserve source text/URLs used by saved evidence while removing old storefront HTML from a NEW snapshot. */
export function compactShopifySource(source: Source): Source {
  if (!source.shopify) return source;
  const { rawHtml: _html, ...rest } = source; void _html;
  return { ...rest, shopify: { ...source.shopify, product: compactProduct(source.shopify.product) } };
}

/** Public Ajax product endpoint is primary; this never requests storefront product HTML. */
export async function fetchShopifyProductSource(input: string, options: { shopifyKnown?: boolean } = {}, read = readShopifyProduct): Promise<Source> {
  const canonical = new URL(productIdentityUrl(input)); canonical.search = "";
  const handle = canonical.pathname.match(/\/products\/([^/]+)$/)?.[1];
  if (!handle || canonical.protocol !== "https:") throw new WorkflowError("Choose a public HTTPS Shopify product URL.", 400);
  const endpoint = new URL(canonical); endpoint.pathname += ".js";
  let product: Record<string, unknown>;
  try {
    product = await read(endpoint.href);
    if (product.handle !== decodeURIComponent(handle) || !Array.isArray(product.variants) || !product.variants.length || !Array.isArray(product.options) || typeof product.title !== "string") throw new ShopifyProductError("Not a public Shopify product", "unsupported");
  } catch (error) {
    if (!options.shopifyKnown && error instanceof ShopifyProductError && error.kind === "unsupported") throw new WorkflowError("This version supports Shopify stores with public product data. Choose a Shopify product URL; existing saved research is retained.", 422);
    throw new WorkflowError("This Shopify product's public data is currently unavailable. Try this product again later or choose another public product URL; saved research is retained.", 502);
  }
  const compact = compactProduct(product), fetchedAt = new Date().toISOString();
  const images = (compact.images as unknown[]).flatMap(value => { const url = typeof value === "string" ? value : record(value).src || record(value).url; try { return typeof url === "string" ? [new URL(url, canonical).href] : []; } catch { return []; } });
  return { url: canonical.href, requestedUrl: input, finalUrl: canonical.href, title: compact.title, description: compact.description.slice(0, 4000), markdown: `${compact.title}\n\n${compact.description}`, images: [...new Set(images)].slice(0, MAX_RESEARCH_ASSETS), colors: {}, links: [], pageType: "product", fetchedAt, shopify: { url: endpoint.href, fetchedAt, product: compact } };
}
