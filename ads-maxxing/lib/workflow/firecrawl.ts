import type { Product } from "./types";
import type { Source } from "./session-types";
import { requireKey, webUrl, WorkflowError } from "./validation";
import { absolute, pageHint } from "./research/extract";
import { fetchShopifyProductSource } from "./research/shopify-fetch";

async function firecrawl(endpoint: string, body: object, timeout = 75000) {
  const response = await fetch(`https://api.firecrawl.dev/v2/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${requireKey("FIRECRAWL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new WorkflowError(`Firecrawl returned HTTP ${response.status}. Check your key, credits, and URL.`, 502);
  const result = await response.json();
  if (!result.success) throw new WorkflowError("Firecrawl could not retrieve this page. Try a direct product URL.", 502);
  return result;
}
export function snapshotHtml(html: string) {
  if (html.length <= 800000) return html;
  // Structured product data often lives after very large storefront CSS/runtime bundles.
  // Keep complete bounded data scripts first rather than cutting them off at the raw prefix.
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>[\s\S]*?<\/script>/gi)]
    .map(match => match[0]).filter(script => script.length <= 200000).sort((a, b) => Number(b.includes("application/ld+json")) - Number(a.includes("application/ld+json")));
  let retained = "";
  for (const script of scripts) if (retained.length + script.length <= 400000) retained += script;
  return retained + html.slice(0, 800000 - retained.length);
}
export function normalizeScrape(url: string, result: { data: Record<string, unknown>; creditsUsed?: number }): Source {
  const data = result.data;
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  if (Number(metadata.statusCode) >= 400) throw new WorkflowError(`The store returned HTTP ${metadata.statusCode}. Try another URL.`, 502);
  const brand = (data.branding || {}) as Record<string, unknown>;
  const finalUrl = absolute(metadata.url || metadata.sourceURL, url) || url;
  const images = Array.isArray(data.images) ? data.images : [];
  const normalized = [metadata.ogImage, ...images].flatMap(image => { const value = absolute(image, finalUrl); return value ? [value] : []; });
  const links = (Array.isArray(data.links) ? data.links : []).flatMap(link => { const value = absolute(link, finalUrl); return value ? [value] : []; });
  return {
    url: webUrl(url), requestedUrl: url, finalUrl,
    title: String(metadata.ogTitle || metadata.title || new URL(url).hostname).slice(0, 500),
    description: String(metadata.ogDescription || metadata.description || "").slice(0, 4000),
    // Preserve candidates before classification, bounded for a snapshot rather than first-page order.
    images: [...new Set(normalized)].slice(0, 300), links: [...new Set(links)].slice(0, 500),
    markdown: String(data.markdown || "").slice(0, 40000), rawHtml: snapshotHtml(String(data.rawHtml || data.html || "")),
    branding: brand, pageType: pageHint(finalUrl), fetchedAt: new Date().toISOString(), providerUsage: result.creditsUsed,
    colors: Object.fromEntries(Object.entries((brand.colors || {}) as object).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(entry[1]))),
  };
}
export async function scrapePage(url: string, branding = false): Promise<Source> {
  if (!branding && pageHint(url) === "product") return fetchShopifyProductSource(url);
  const source = normalizeScrape(url, await firecrawl("scrape", { url: webUrl(url), formats: ["markdown", "rawHtml", "links", "images", ...(branding ? ["branding"] : [])], onlyMainContent: false, maxAge: 0, timeout: 60000 }));
  return source;
}
export async function discoverPages(url: string, search: string): Promise<string[]> {
  const result = await firecrawl("map", { url: webUrl(url), search: search.slice(0, 200), limit: 100, includeSubdomains: false }, 30000);
  return (result.links || []).flatMap((item: { url?: string } | string) => { const value = absolute(typeof item === "string" ? item : item.url, url); return value ? [value] : []; }).slice(0, 100);
}
export async function scrapeProduct(url: string): Promise<Product> { return scrapePage(url); }
