import { readFile } from "node:fs/promises";
import path from "node:path";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const graphemes = (text: string) => Array.from(segmenter.segment(text), item => item.segment);

// Match whole graphemes: flags, skin tones and ZWJ families must stay together.
export async function emojiImages(text: string): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  for (const glyph of new Set(graphemes(text))) {
    if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(glyph) || glyph.includes("\ufe0e")) continue;
    const fullCode = Array.from(glyph).map(char => char.codePointAt(0)!.toString(16)).join("-");
    for (const code of new Set([fullCode, fullCode.split("-").filter(part => part !== "fe0f").join("-")])) {
      try {
        const svg = await readFile(path.join(process.cwd(), "node_modules/@twemoji/svg", `${code}.svg`));
        images[glyph] = `data:image/svg+xml;base64,${svg.toString("base64")}`;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // Unknown emoji is rejected by normal glyph validation, never substituted.
      }
    }
  }
  return images;
}

export function textRuns(text: string, images: Record<string, string>): { text: string; image?: string }[] {
  const runs: { text: string; image?: string }[] = [];
  for (const glyph of graphemes(text)) {
    if (images[glyph]) runs.push({ text: glyph, image: images[glyph] });
    else if (runs.length && !runs[runs.length - 1].image) runs[runs.length - 1].text += glyph;
    else runs.push({ text: glyph });
  }
  return runs;
}
