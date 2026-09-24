import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Research } from "../session-types";

/** Display-only conversion: keep the original quote for source verification. */
export function plainOffer(markdown: string) {
  // Some scraped offers escape their bold markers. Decode only that convention;
  // the Markdown parser still decides whether the markers form actual formatting.
  const tree = fromMarkdown(markdown.replaceAll("\\*\\*", "**"));
  return tree.children
    .map(node => toString(node, { includeHtml: false }))
    .join(" ")
    .trim();
}

/** Normalize new research and legacy display projections without changing evidence. */
export function normalizeResearchOffers<T extends Research>(research: T): T {
  return {
    ...research,
    sales: research.sales.map(sale => ({ ...sale, description: plainOffer(sale.quote) })),
    ...(research.offers ? { offers: research.offers.map(offer => ({
      ...offer,
      displayCopy: plainOffer(offer.quote),
      restrictions: plainOffer(offer.restrictions),
    })) } : {}),
  };
}
