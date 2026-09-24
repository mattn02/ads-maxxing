import { assembleResearch } from "../lib/workflow/agents/researcher";
import { extractSource } from "../lib/workflow/research/extract";
import type { Research, Source } from "../lib/workflow/session-types";
export function productResearch(source: Source): Research {
  const extracted = extractSource({ ...source, rawHtml: `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: source.title, url: source.url, image: source.images })}</script>` });
  const product = extracted.products[0];
  return { ...assembleResearch([source], { voice: "Playful", audience: "Inferred", sales: [] }), schemaVersion: 2, revision: 1,
    products: extracted.products, assets: extracted.assets, offers: [], customerEvidence: [],
    campaign: { direction: { text: source.url, origin: "specific_url", url: source.url }, brandRevision: 1, productIds: [product.id], selectedProductId: product.id, status: "ready_for_brief" } };
}
