import { z } from "zod";
import type { ResearchAsset, ResearchProduct } from "./contracts";
import { WorkflowError } from "../validation";

export const campaignScopeSchema = z.object({
  members: z.array(z.object({ productId: z.string().min(1), variantId: z.string().min(1).nullable() })),
  coverage: z.object({ status: z.enum(["partial", "unknown"]), foundProductIds: z.array(z.string().min(1)), attemptedUrls: z.array(z.string().url()), failedUrls: z.array(z.string().url()) }),
});
export type CampaignScope = z.infer<typeof campaignScopeSchema>;
export type CampaignMember = CampaignScope["members"][number];

/** Catalog discovery is bounded. Membership must be supplied separately; finding a product never includes it. */
export function createCampaignScope(products: ResearchProduct[], members: CampaignMember[], attemptedUrls: string[] = [], failedUrls: string[] = []): CampaignScope {
  for (const member of members) {
    const product = products.find(product => product.id === member.productId);
    if (!product || member.variantId !== null && !product.variants.some(variant => variant.id === member.variantId)) throw new WorkflowError("Campaign membership must use a discovered product and its actual variant.");
  }
  return campaignScopeSchema.parse({
    members: [...new Map(members.map(member => [JSON.stringify([member.productId, member.variantId]), member])).values()],
    coverage: { status: attemptedUrls.length ? "partial" : "unknown", foundProductIds: [...new Set(products.map(product => product.id))], attemptedUrls: [...new Set(attemptedUrls)], failedUrls: [...new Set(failedUrls)] },
  });
}

/** The active ad target is not the campaign membership set. Legacy selection grants only its one product. */
export function scopeForCampaign(campaign: { scope?: CampaignScope; selectedProductId: string | null }, products: ResearchProduct[]): CampaignScope {
  if (campaign.scope) {
    const scope = campaignScopeSchema.parse(campaign.scope);
    const checked = createCampaignScope(products, scope.members, scope.coverage.attemptedUrls, scope.coverage.failedUrls);
    return { ...scope, members: checked.members };
  }
  return createCampaignScope(products, campaign.selectedProductId ? [{ productId: campaign.selectedProductId, variantId: null }] : []);
}

export function memberReferenceReadiness(member: CampaignMember, products: ResearchProduct[], assets: ResearchAsset[]) {
  const product = products.find(product => product.id === member.productId);
  const variant = member.variantId ? product?.variants.find(variant => variant.id === member.variantId) : null;
  const referenceAssetIds = product && (!member.variantId || variant) ? assets.filter(asset =>
    product.assetIds.includes(asset.id) && asset.productIds.includes(product.id) && asset.eligibleAsProductReference &&
    ["verified_structure", "user_confirmed"].includes(asset.classification) && ["product_photo", "product_lifestyle"].includes(asset.role) &&
    (!member.variantId || !!variant?.assetIds.includes(asset.id) && asset.variantIds.includes(member.variantId)),
  ).map(asset => asset.id) : [];
  return { status: referenceAssetIds.length ? "ready" as const : "needs_reference" as const, referenceAssetIds,
    reason: referenceAssetIds.length ? "A verified reference is available." : member.variantId ? "No verified photo establishes this exact variant." : "No verified product photo is available." };
}

export type DeviceTarget = { generation: number; model?: "pro max" | "pro" | "plus" | "mini" | "air" | "max" | "e" | "standard" };
function devicesInText(text: string): DeviceTarget[] {
  return [...text.replace(/[-_]/g, " ").matchAll(/\biphone\s*(\d{1,2})(?:\s*(pro\s*max|pro|plus|mini|air|max|e))?\b/gi)].map(match =>
    ({ generation: Number(match[1]), ...(match[2] ? { model: match[2].toLowerCase().replace(/\s*/g, "") === "promax" ? "pro max" as const : match[2].toLowerCase() as DeviceTarget["model"] } : {}) }));
}
export const deviceTarget = (text: string): DeviceTarget | null => devicesInText(text)[0] ?? null;

/** Match explicit option values only, never SKU, price, product title, or generic photo appearance. */
export function matchingDeviceMembers(products: ResearchProduct[], target: DeviceTarget): CampaignMember[] {
  return products.flatMap(product => product.variants.filter(variant => Object.values(variant.attributes).some(value => devicesInText(value).some(found =>
    found.generation === target.generation && (!target.model || (found.model ?? "standard") === target.model),
  ))).map(variant => ({ productId: product.id, variantId: variant.id })));
}
