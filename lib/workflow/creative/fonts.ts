import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, type Font } from "opentype.js";
import { CREATIVE_FONT_FAMILY } from "./schema";

type CreativeFont = { family: string; data: ArrayBuffer; font: Font };
let bundledFont: Promise<CreativeFont> | undefined;

/** Fitting and rendering share the same bundled font bytes. */
export function loadCreativeFont(): Promise<CreativeFont> {
  bundledFont ??= readFile(path.join(process.cwd(), "assets/fonts/Geist-Regular.ttf"))
    .then(bytes => {
      const data = Uint8Array.from(bytes).buffer;
      return { family: CREATIVE_FONT_FAMILY, data, font: parse(data) };
    }).catch(error => {
      bundledFont = undefined;
      throw error;
    });
  return bundledFont;
}
