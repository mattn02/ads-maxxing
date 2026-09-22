import type { Product } from "./types";
import { requireKey, webUrl, WorkflowError } from "./validation";

export async function scrapeProduct(url: string): Promise<Product> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireKey("FIRECRAWL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "images"], onlyMainContent: true, timeout: 60000 }),
    signal: AbortSignal.timeout(75000),
  });
  if (!response.ok) throw new WorkflowError(`Firecrawl returned HTTP ${response.status}. Check your key, credits, and product URL.`, 502);
  const result = await response.json();
  if (!result.success || !result.data) throw new WorkflowError("Firecrawl could not scrape this page. Try a direct product URL.", 502);
  const { metadata = {}, markdown = "", images = [] } = result.data;
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
  };
}
