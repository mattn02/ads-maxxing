import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

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
