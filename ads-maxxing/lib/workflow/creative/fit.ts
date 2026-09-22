import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "opentype.js";
import { WorkflowError } from "../validation";
import type { Brief, Research } from "../session-types";
import { brandTokensSchema, designSchema } from "./schema";
import { emojiImages, graphemes, textRuns } from "./emoji";

let fontPromise: ReturnType<typeof loadFont> | undefined;
async function loadFont() {
  const bytes = await readFile(path.join(process.cwd(), "assets/fonts/Geist-Regular.ttf"));
  const data = Uint8Array.from(bytes).buffer;
  return { data, font: parse(data) };
}
export function creativeFont() { return fontPromise ??= loadFont(); }
export type FittedText = { lines: string[]; size: number; lineHeight: number; emojis: Record<string, string> };
export type CopyLayout = { headline: FittedText; cta: FittedText; offer?: FittedText };

async function fit(text: string, label: string, sizes: number[], width: number, height: number, maxLines: number): Promise<FittedText> {
  const { font } = await creativeFont();
  const emojis = await emojiImages(text);
  for (const glyph of graphemes(text)) {
    if (emojis[glyph]) continue;
    for (const char of glyph) {
      if (char === "\n") continue;
      if (/\p{C}/u.test(char) || !font.hasChar(char)) {
        throw new WorkflowError(`${label} contains an unsupported character (${JSON.stringify(char)}). Use text supported by Geist or an emoji available in the bundled Twemoji set.`);
      }
    }
  }
  for (const size of sizes) {
    const measure = (value: string) => textRuns(value, emojis).reduce((width, run) => width + (run.image ? size : font.getAdvanceWidth(run.text, size, { kerning: false }) * 1.03), 0);
    const lines: string[] = [];
    let overflow = false;
    for (const paragraph of text.split("\n")) {
      let line = "";
      // Keep all source characters, including repeated spaces; only insert line breaks.
      for (const word of paragraph.match(/\S+\s*|\s+/g) || [""]) {
        if (measure(word) > width) { overflow = true; break; }
        if (line && measure(line + word) > width) { lines.push(line); line = word; }
        else line += word;
      }
      lines.push(line);
    }
    const lineHeight = Math.ceil(size * 1.12);
    if (!overflow && lines.length <= maxLines && lines.length * lineHeight <= height) return { lines, size, lineHeight, emojis };
  }
  throw new WorkflowError(`${label} does not fit this template. Shorten ${label === "Offer terms" ? "the evidenced offer by selecting a shorter complete source quote, or choose no offer" : `the ${label.toLowerCase()}`} and save a new brief. Approved copy will not be truncated.`);
}
export async function validateCreative(brief: Brief, research: Research): Promise<CopyLayout> {
  const design = designSchema.parse(brief.design);
  brandTokensSchema.parse(brief.tokens);
  const sale = research.sales.find(item => item.id === brief.saleId);
  if (brief.saleId && !sale) throw new WorkflowError("The selected offer is missing from the saved research.");
  return {
    headline: await fit(brief.headline, "Headline", design.headlineStyle === "oversized" ? [60, 56, 52] : [48, 44, 40, 36], 512, 168, 3),
    cta: await fit(brief.cta, "CTA", [24, 22, 20], 456, 32, 1),
    ...(sale ? { offer: await fit(sale.quote, "Offer terms", [18, 17, 16], 512, 66, 3) } : {}),
  };
}
