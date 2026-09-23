import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, type Font } from "opentype.js";
import { z } from "zod";
import type { BrandTokens } from "./schema";

type FontsourceToken = Extract<BrandTokens, { fontId: "fontsource" }>;
type FontsourceSelection = Pick<FontsourceToken, "fontId" | "sourceId" | "family" | "weight" | "style" | "format" | "version" | "fileUrl">;
type FontSelection = { fontId: "geist-fallback" } | FontsourceSelection;
export type CreativeFont = { family: string; data: ArrayBuffer; font: Font };

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math",
  "fangsong", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset",
]);
const API_ORIGIN = "https://api.fontsource.org";
const CDN_ORIGIN = "https://cdn.jsdelivr.net";
const MAX_FAMILIES_PER_ROLE = 2;
const MAX_API_BYTES = 250_000;
const MAX_FONT_BYTES = 2_000_000;

const fontsourceResponseSchema = z.object({
  id: z.string(),
  family: z.string(),
  defSubset: z.string(),
  weights: z.array(z.number()),
  styles: z.array(z.string()),
  npmVersion: z.string(),
  variants: z.record(z.string(), z.unknown()),
});

const lookupCache = new Map<string, Promise<FontsourceSelection>>();
const fontCache = new Map<string, Promise<CreativeFont>>();

/** Parsing alone does not prove opentype.js can apply a font's shaping tables. */
export function assertCreativeFontCompatible(font: Pick<Font, "getAdvanceWidth">) {
  const width = font.getAdvanceWidth("Aa fi 0123", 24, { kerning: false });
  if (!Number.isFinite(width) || width <= 0) throw new Error("The font returned invalid text metrics.");
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load();
  cache.set(key, pending);
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

function splitFamilyList(value: string) {
  const families: string[] = [];
  let current = "", quote = "";
  for (const character of value.replace(/^\s*font-family\s*:\s*/i, "")) {
    if ((character === "\"" || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
    } else if (character === "," && !quote) {
      families.push(current); current = "";
    } else current += character;
  }
  families.push(current);
  return families;
}

export function normalizeObservedFamilies(value: string | null | undefined) {
  if (!value) return [];
  return splitFamilyList(value).map(family => family.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").replace(/\s+/g, " ").trim())
    .filter(family => family && !GENERIC_FAMILIES.has(family.toLowerCase()));
}

function fontsourceId(family: string) {
  return family.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function exactFamily(left: string, right: string) {
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  return normalize(left) === normalize(right);
}

function expectedFontsourceUrl(fileUrl: string, sourceId: string, version: string, allowLatest: boolean) {
  const url = new URL(fileUrl);
  const selectedVersion = allowLatest ? "latest" : version;
  const prefix = `/fontsource/fonts/${sourceId}@${selectedVersion}/`;
  if (url.protocol !== "https:" || url.origin !== CDN_ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) {
    throw new Error("Fontsource returned an unexpected font file location.");
  }
  const format = url.pathname.endsWith(".ttf") ? "ttf" : url.pathname.endsWith(".woff") ? "woff" : null;
  if (!format) throw new Error("Fontsource did not provide a supported static TTF or WOFF file.");
  return { url, format } as const;
}

function pinFontsourceUrl(fileUrl: string, sourceId: string, version: string) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Fontsource did not provide a pinnable package version.");
  const { url, format } = expectedFontsourceUrl(fileUrl, sourceId, version, true);
  url.pathname = url.pathname.replace(`/${sourceId}@latest/`, `/${sourceId}@${version}/`);
  expectedFontsourceUrl(url.href, sourceId, version, false);
  return { fileUrl: url.href, format };
}

async function fetchJson(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(2500), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Fontsource lookup failed (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_API_BYTES) throw new Error("Fontsource returned an oversized lookup response.");
  const body = await response.text();
  if (body.length > MAX_API_BYTES) throw new Error("Fontsource returned an oversized lookup response.");
  return JSON.parse(body) as unknown;
}

async function fetchFontData(selection: FontsourceSelection, fetcher: typeof fetch) {
  const expected = expectedFontsourceUrl(selection.fileUrl, selection.sourceId, selection.version, false);
  if (expected.format !== selection.format) throw new Error("The saved Fontsource format does not match its file.");
  const response = await fetcher(selection.fileUrl, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Fontsource font download failed (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FONT_BYTES) throw new Error("Fontsource font file is too large.");
  const data = await response.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_FONT_BYTES) throw new Error("Fontsource returned an unsupported font file size.");
  return data;
}

async function lookupFamily(family: string, fetcher: typeof fetch) {
  const sourceId = fontsourceId(family);
  if (!sourceId) throw new Error("The observed font family has no Fontsource ID.");
  return cached(lookupCache, `${sourceId}:${family.normalize("NFKC").toLocaleLowerCase("en-US")}`, async () => {
    const raw = fontsourceResponseSchema.parse(await fetchJson(`${API_ORIGIN}/v1/fonts/${encodeURIComponent(sourceId)}`, fetcher));
    if (raw.id !== sourceId || !exactFamily(raw.family, family)) throw new Error("Fontsource did not return an exact family match.");
    if (!raw.weights.includes(400) || !raw.styles.includes("normal")) throw new Error("Fontsource has no static normal 400 face for this family.");
    const weight = raw.variants["400"] as Record<string, unknown> | undefined;
    const normal = weight?.normal as Record<string, unknown> | undefined;
    const subsets = [raw.defSubset, "latin", ...Object.keys(normal || {})].filter((value, index, all) => all.indexOf(value) === index);
    let file: string | null = null;
    for (const subset of subsets) {
      const candidate = normal?.[subset] as { url?: Record<string, unknown> } | undefined;
      if (typeof candidate?.url?.ttf === "string") { file = candidate.url.ttf; break; }
      if (typeof candidate?.url?.woff === "string") { file = candidate.url.woff; break; }
    }
    if (!file) throw new Error("Fontsource has no supported static file for this family.");
    const pinned = pinFontsourceUrl(file, sourceId, raw.npmVersion);
    const selection = { fontId: "fontsource", sourceId, family: raw.family, weight: 400, style: "normal", version: raw.npmVersion, ...pinned } as const;
    await loadCreativeFont(selection, fetcher);
    return selection;
  });
}

export async function resolveBrandFont(heading: string | null | undefined, body: string | null | undefined, fetcher: typeof fetch = fetch): Promise<FontSelection> {
  const candidates = [
    ...normalizeObservedFamilies(heading).slice(0, MAX_FAMILIES_PER_ROLE),
    ...normalizeObservedFamilies(body).slice(0, MAX_FAMILIES_PER_ROLE),
  ];
  for (const family of candidates) {
    try { return await lookupFamily(family, fetcher); }
    catch { /* A pre-approval lookup may safely try the next family. */ }
  }
  return { fontId: "geist-fallback" };
}

async function loadGeist(): Promise<CreativeFont> {
  const bytes = await readFile(path.join(process.cwd(), "assets/fonts/Geist-Regular.ttf"));
  const data = Uint8Array.from(bytes).buffer;
  const font = parse(data);
  assertCreativeFontCompatible(font);
  return { family: "Geist", data, font };
}

export function loadCreativeFont(selection: FontSelection, fetcher: typeof fetch = fetch) {
  if (selection.fontId === "geist-fallback") return cached(fontCache, "geist-fallback", loadGeist);
  return cached(fontCache, selection.fileUrl, async () => {
    const data = await fetchFontData(selection, fetcher);
    const font = parse(data);
    assertCreativeFontCompatible(font);
    return { family: selection.family, data, font };
  });
}

export function clearFontCachesForTests() {
  lookupCache.clear(); fontCache.clear();
}
