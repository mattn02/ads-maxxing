import { z } from "zod";

export const generationSourceSchema = z.union([
  z.object({ choiceId: z.string().min(1).max(160) }).strict(),
  z.object({ direction: z.string().trim().min(1).max(2000) }).strict(),
]);
export const generationIntentSchema = z.object({
  requestId: z.string().uuid(), source: generationSourceSchema, authorizedAt: z.string(),
  researchId: z.string().optional(), briefId: z.string().optional(),
  previousRequestId: z.string().uuid().optional(),
  refinement: z.object({ variantId: z.string().min(1), feedback: z.string().trim().min(1).max(2000) }).optional(),
  pausedReason: z.enum(["failure", "needs_input"]).optional(), error: z.string().optional(),
});
export const generateCampaignActionSchema = z.object({ action: z.literal("generateCampaign"), requestId: z.string().uuid(), source: generationSourceSchema });
export const continueCampaignActionSchema = z.object({ action: z.literal("continueCampaign"), requestId: z.string().uuid() });
export const retryCreativeActionSchema = z.object({ action: z.literal("retryCreative"), requestId: z.string().uuid(), previousRequestId: z.string().uuid(), briefId: z.string().uuid(), acknowledgePossibleDuplicate: z.boolean().optional() });
const member = { productId: z.string().min(1), variantId: z.string().min(1).nullable() };
export const setCampaignScopeActionSchema = z.object({ action: z.literal("setCampaignScope"), members: z.array(z.object(member)).min(1).max(200) });
export const selectCampaignMemberActionSchema = z.object({ action: z.literal("selectCampaignMember"), ...member });
export const generateCampaignMemberActionSchema = z.object({ action: z.literal("generateCampaignMember"), requestId: z.string().uuid(), ...member });
export const refineAdActionSchema = z.object({ action: z.literal("refineAd"), requestId: z.string().uuid(), variantId: z.string().min(1), feedback: z.string().trim().min(1).max(2000) });
export type GenerationSource = z.infer<typeof generationSourceSchema>;
export type GenerationIntent = z.infer<typeof generationIntentSchema>;
export type NextAction = { kind: "continue" | "retry" | "needs_input" | "complete"; requestId: string; message?: string; variantId?: string; briefId?: string; duplicateRisk?: boolean };
