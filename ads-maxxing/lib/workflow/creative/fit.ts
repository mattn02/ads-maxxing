import { WorkflowError } from "../validation";
import type { Brief, Research } from "../session-types";
import { adCopySchema } from "../schema";
import { brandTokensSchema, creativeFontFamily, designSchema, type BrandTokens } from "./schema";
import { emojiImages, graphemes, textRuns } from "./emoji";
import { loadCreativeFont } from "./fonts";

class CopyFitError extends WorkflowError {}

export async function creativeFont(tokens: BrandTokens) {
  try { return await loadCreativeFont(tokens); }
  catch {
    throw new WorkflowError(`The approved ${creativeFontFamily(tokens)} font could not be loaded or shaped. Any saved product scene is retained; use Finish saved creative to retry composition without generating a new scene.`, 502);
  }
}
export type FittedText = { lines: string[]; size: number; lineHeight: number; emojis: Record<string, string> };
export type CopyLayout = { headline: FittedText; cta: FittedText; price?: FittedText; offer?: FittedText };
export type CopyValidationError = { field: "headline" | "cta"; message: string };

const OFFER_FRESHNESS_MS = 86_400_000;
function currentConfirmedOffer(brief: Brief, research: Research, now = Date.now()) {
  if (!brief.saleId || !brief.productId) return null;
  const offer = research.offers?.find(item => item.id === brief.saleId);
  const sale = research.sales.find(item => item.id === brief.saleId);
  const checkedAt = offer ? Date.parse(offer.checkedAt) : Number.NaN;
  const endsAt = offer?.endsAt ? Date.parse(offer.endsAt) : null;
  if (!offer || !sale || offer.eligibility !== "eligible" || offer.confirmationOrigin !== "user_supplied" || !offer.confirmedAt || !offer.productIds.includes(brief.productId) || !Number.isFinite(checkedAt) || now - checkedAt > OFFER_FRESHNESS_MS || checkedAt > now + 300_000 || (endsAt !== null && (!Number.isFinite(endsAt) || endsAt <= now)) || sale.quote !== offer.quote || sale.sourceUrl !== offer.sourceUrl) {
    throw new WorkflowError("The selected offer is unresolved, stale, expired, or not confirmed for this product. Recheck it or continue without an offer.");
  }
  return { offer, sale };
}

export function eligibleOffersForProduct(research: Research, productId: string, now = Date.now()) {
  return (research.offers ?? []).flatMap(offer => {
    try {
      const resolved = currentConfirmedOffer({ saleId: offer.id, productId } as Brief, research, now);
      return resolved ? [resolved] : [];
    } catch { return []; }
  }).sort((a, b) => Date.parse(b.offer.confirmedAt!) - Date.parse(a.offer.confirmedAt!) || Date.parse(b.offer.checkedAt) - Date.parse(a.offer.checkedAt));
}

export function formatResearchedPrice(brief: Brief, research: Research) {
  const price = research.products?.find(item => item.id === brief.productId)?.price;
  if (!price) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency, currencyDisplay: "symbol" }).format(price.amount);
  } catch {
    throw new WorkflowError("The saved product price has an invalid currency and cannot be rendered safely.");
  }
}

export function resolveCommercialCopy(brief: Brief, research: Research) {
  return {
    price: formatResearchedPrice(brief, research),
    offer: currentConfirmedOffer(brief, research)?.sale.quote ?? null,
  };
}

async function fit(text: string, label: string, sizes: number[], width: number, height: number, maxLines: number, tokens: BrandTokens): Promise<FittedText> {
  const { font } = await creativeFont(tokens);
  const emojis = await emojiImages(text);
  for (const glyph of graphemes(text)) {
    if (emojis[glyph]) continue;
    for (const char of glyph) {
      if (char === "\n") continue;
      if (/\p{C}/u.test(char) || !font.hasChar(char)) {
        throw new CopyFitError(`${label} contains an unsupported character (${JSON.stringify(char)}). Use text supported by ${creativeFontFamily(tokens)} or an emoji available in the bundled Twemoji set.`);
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
  throw new CopyFitError(`${label} does not fit this template. Shorten ${label === "Offer terms" ? "the evidenced offer by selecting a shorter complete source quote, or choose no offer" : `the ${label.toLowerCase()}`} and save a new brief. Approved copy will not be truncated.`);
}
export async function generatedCopyErrors(brief: Pick<Brief, "headline" | "cta" | "design" | "tokens">): Promise<CopyValidationError[]> {
  const design = designSchema.parse(brief.design);
  const tokens = brandTokensSchema.parse(brief.tokens);
  const parsed = adCopySchema.safeParse({ headline: brief.headline, cta: brief.cta });
  const errors: CopyValidationError[] = parsed.success ? [] : parsed.error.issues.flatMap(issue => {
    const field = issue.path[0];
    return field === "headline" || field === "cta" ? [{ field, message: issue.message }] : [];
  });
  const invalid = new Set(errors.map(error => error.field));
  for (const field of ["headline", "cta"] as const) {
    if (invalid.has(field)) continue;
    try {
      if (field === "headline") await fit(brief.headline, "Headline", design.headlineStyle === "oversized" ? [60, 56, 52] : [48, 44, 40, 36], 512, 168, 3, tokens);
      else await fit(brief.cta, "CTA", [24, 22, 20], 456, 32, 1, tokens);
    } catch (error) {
      if (!(error instanceof CopyFitError)) throw error;
      errors.push({ field, message: error instanceof Error ? error.message : `${field} is invalid.` });
    }
  }
  return errors;
}
export async function validateCreative(brief: Brief, research: Research): Promise<CopyLayout> {
  const design = designSchema.parse(brief.design);
  const tokens = brandTokensSchema.parse(brief.tokens);
  const commercial = resolveCommercialCopy(brief, research);
  const copyErrors = await generatedCopyErrors(brief);
  if (copyErrors.length) throw new WorkflowError(copyErrors.map(error => `${error.field}: ${error.message}`).join("; "));
  return {
    headline: await fit(brief.headline, "Headline", design.headlineStyle === "oversized" ? [60, 56, 52] : [48, 44, 40, 36], 512, 168, 3, tokens),
    cta: await fit(brief.cta, "CTA", [24, 22, 20], 456, 32, 1, tokens),
    ...(commercial.price ? { price: await fit(commercial.price, "Price", [30, 28, 26, 24], 512, 34, 1, tokens) } : {}),
    ...(commercial.offer ? { offer: await fit(commercial.offer, "Offer terms", [17, 16, 15, 14], 512, 54, 3, tokens) } : {}),
  };
}
