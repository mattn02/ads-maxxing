import { z } from "zod";
import { designSchema } from "./creative/schema";

const shortText = z.string().trim().min(1).max(2000);
// Normalize common model formatting without accepting malformed URLs or IDs.
const researchUrl = z.string().trim().transform(value => {
  const link = value.match(/^\[[^\]]*\]\(([^\s)]+)\)$/);
  const url = link?.[1] ?? value;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i.test(url) ? `https://${url}` : url;
}).pipe(z.string().url().refine(value => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL."));
const absentResearchUrl = z.string().trim().refine(value => /^(?:null|none)?$/i.test(value), "Use null when no URL is supplied.");
const optionalResearchUrl = z.union([researchUrl, absentResearchUrl, z.null()])
  .optional().transform(value => !value || /^(null|none)$/i.test(value) ? null : value);
const optionalId = z.string().trim().nullish().transform(value => !value || /^(null|none)$/i.test(value) ? null : value);
export const researchInputSchema = z.object({
  url: researchUrl.describe("Store URL as plain text."),
  productUrl: optionalResearchUrl.describe("Optional product page URL; use null when absent."),
  direction: z.string().trim().max(2000).nullable().transform(value => value || undefined).optional(),
  choiceId: z.string().trim().max(160).nullable().transform(value => value || undefined).optional(),
  campaignUrl: optionalResearchUrl.describe("Optional campaign page URL; use null when absent."),
});
export const findingsSchema = z.object({
  voice: shortText.describe("Inferred brand voice; say unknown when evidence is insufficient."),
  audience: shortText.describe("Inferred audience; say unknown when evidence is insufficient."),
  sales: z.array(z.object({
    description: shortText,
    sourceUrl: z.string().url(),
    quote: shortText.describe("Verbatim source excerpt including conditions; never invent a deal."),
  })).max(10),
});
export const briefSchema = z.object({
  design: designSchema.optional(),
  productId: z.string().optional(),
  referenceAssetId: z.string().optional(),
  variantId: z.string().nullable().optional(),
  logoAssetId: z.string().nullable().optional(),
  variation: z.enum(["auto", "scene", "background"]).optional().describe("Use auto to reuse compatible assets. scene explicitly requests another scene; background requests another environment and scene."),
  productUrl: z.string().url(),
  referenceImage: z.string().url(),
  headline: z.string().trim().min(1).max(120),
  cta: z.string().trim().min(1).max(50),
  direction: shortText,
  saleId: optionalId.describe("An existing researched sale ID, or JSON null for no offer."),
  feedback: z.string().max(2000).describe("User feedback driving this revision; empty for the first draft."),
  parentVariantId: optionalId.describe("An existing variant ID when iterating, or JSON null for the first ad."),
});
const criterion = z.object({
  status: z.enum(["pass", "fail", "uncertain"]),
  reason: shortText,
});
export const visualReviewSchema = z.object({
  productFidelity: criterion,
  textLegibility: criterion,
  claimAccuracy: criterion,
  brandFit: criterion,
  summary: shortText,
});
export type ResearchInput = z.infer<typeof researchInputSchema>;
export type Findings = z.infer<typeof findingsSchema>;
export type BriefInput = z.infer<typeof briefSchema>;
export type VisualReview = z.infer<typeof visualReviewSchema>;
