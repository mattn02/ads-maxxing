import { z } from "zod";

const id = z.string().min(1).max(160);
const url = z.string().url();
export const stageSchema = z.enum(["brand_researching", "awaiting_direction", "campaign_researching", "needs_selection", "ready_for_brief"]);
export const directionSchema = z.object({ text: z.string().min(1).max(2000), origin: z.enum(["user_message", "specific_url", "choice"]), messageId: z.string().optional(), choiceId: z.string().optional(), url: url.optional() });
export const researchStateSchema = z.object({ stage: stageSchema, direction: directionSchema.optional() });
export type ResearchState = z.infer<typeof researchStateSchema>;
export type Direction = z.infer<typeof directionSchema>;
export const evidenceSchema = z.object({ sourceUrl: url, quote: z.string().max(4000), method: z.enum(["json_ld", "shopify", "page", "branding", "user"]), origin: z.enum(["observed", "inferred", "user_supplied"]) });
const optionalFinding = z.object({ status: z.enum(["found", "not_found", "not_checked", "failed"]), value: z.string().nullable(), evidence: evidenceSchema.optional() });
export const productSchema = z.object({
  id, canonicalUrl: url, storeId: z.string().nullable(), title: z.string(), description: z.string(),
  evidence: evidenceSchema, assetIds: z.array(id),
  variants: z.array(z.object({ id, storeId: z.string(), title: z.string(), attributes: z.record(z.string(), z.string()), assetIds: z.array(id) })),
  price: z.object({ amount: z.number().nonnegative(), currency: z.string(), availability: z.string().nullable() }).nullable(),
});
export const assetSchema = z.object({
  id, originalUrl: url, sourceUrl: url,
  role: z.enum(["logo", "product_photo", "product_lifestyle", "brand_lifestyle", "promotion_graphic", "icon", "swatch", "unknown"]),
  productIds: z.array(id), variantIds: z.array(id), evidence: evidenceSchema,
  classification: z.enum(["verified_structure", "unresolved", "user_confirmed", "excluded"]),
  eligibleAsProductReference: z.boolean(), containsMultipleProducts: z.boolean().nullable(), containsPromotionalText: z.boolean().nullable(),
  width: z.number().positive().nullable(), height: z.number().positive().nullable(),
});
export const brandKitSchema = z.object({
  id, revision: z.number().int().positive(), canonicalStoreUrl: url, name: z.string(),
  logoAssetIds: z.array(id), selectedLogoAssetId: id.nullable(),
  colors: z.array(z.object({ role: z.string(), value: z.string(), evidence: evidenceSchema })),
  typography: z.object({ heading: optionalFinding, body: optionalFinding, renderFont: z.literal("geist-fallback"), substitution: z.string() }),
  voice: optionalFinding, audience: optionalFinding, valueProposition: optionalFinding,
  overrides: z.record(z.string(), z.string()),
});
export const offerSchema = z.object({ id, sourceUrl: url, quote: z.string(), displayCopy: z.string(), productIds: z.array(id),
  restrictions: z.string(), checkedAt: z.string(), eligibility: z.enum(["unresolved", "eligible", "expired"]), endsAt: z.string().nullable(), confirmedAt: z.string().optional(), confirmationOrigin: z.literal("user_supplied").optional(),
});
export const customerEvidenceSchema = z.object({ id, kind: z.enum(["rating", "testimonial", "customer_count"]), productId: id.nullable(), evidence: evidenceSchema,
  value: z.string(), attribution: z.string().nullable(), ratingCount: z.number().int().nonnegative().nullable(), reviewCount: z.number().int().nonnegative().nullable(), checkedAt: z.string(),
});
export const researchV2FieldsSchema = z.object({
  schemaVersion: z.literal(2), revision: z.number().int().positive(), brandKit: brandKitSchema,
  campaign: z.object({ direction: directionSchema.nullable(), brandRevision: z.number(), productIds: z.array(id), selectedProductId: id.nullable(), status: stageSchema }),
  products: z.array(productSchema), assets: z.array(assetSchema), offers: z.array(offerSchema), customerEvidence: z.array(customerEvidenceSchema),
  suggestions: z.array(z.object({ id, label: z.string(), url, origin: z.literal("observed") })),
  runs: z.array(z.object({ id, scope: z.enum(["brand", "campaign"]), startedAt: z.string(), completedAt: z.string(), attemptedUrls: z.array(url), failedUrls: z.array(url), status: z.enum(["complete", "partial"]), parserVersion: z.string() })),
});
export type ResearchV2Fields = z.infer<typeof researchV2FieldsSchema>;
export type ResearchProduct = z.infer<typeof productSchema>;
export type ResearchAsset = z.infer<typeof assetSchema>;
export type BrandKit = z.infer<typeof brandKitSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
