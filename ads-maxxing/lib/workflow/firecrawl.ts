import type { Product } from "./types";
import type { Source } from "./session-types";
import { requireKey, webUrl, WorkflowError } from "./validation";

export async function scrapePage(url: string, branding = false): Promise<Source> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireKey("FIRECRAWL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "images", ...(branding ? ["branding"] : [])], onlyMainContent: false, maxAge: 0, timeout: 60000 }),
    signal: AbortSignal.timeout(75000),
  });
  if (!response.ok) throw new WorkflowError(`Firecrawl returned HTTP ${response.status}. Check your key, credits, and product URL.`, 502);
  const result = await response.json();
  if (!result.success || !result.data) throw new WorkflowError("Firecrawl could not scrape this page. Try a direct product URL.", 502);
  const { metadata = {}, markdown = "", images = [], branding: brand = {} } = result.data;
  if (metadata.statusCode >= 400) throw new WorkflowError(`The store returned HTTP ${metadata.statusCode}. Try another product URL.`, 502);
  const candidates = [metadata.ogImage, ...images].filter((image): image is string => typeof image === "string");
  const normalized = candidates.flatMap((image) => {
    try { return [webUrl(new URL(image, url).href)]; } catch { return []; }
  });
  return {
    url,
    title: String(metadata.ogTitle || metadata.title || new URL(url).hostname).slice(0, 500),
    description: String(metadata.ogDescription || metadata.description || "").slice(0, 4000),
    images: [...new Set(normalized)].slice(0, 60),
    markdown: String(markdown).slice(0, 30000),
    fetchedAt: new Date().toISOString(),
    colors: Object.fromEntries(Object.entries(brand?.colors || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(entry[1]))),
  };
}
export async function scrapeProduct(url: string): Promise<Product> { return scrapePage(url); }
