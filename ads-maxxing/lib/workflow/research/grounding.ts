import type { BriefInput } from "../schema";
import type { Research } from "../session-types";
import { WorkflowError } from "../validation";
import { canonicalUrl } from "./extract";
import { scopeForCampaign } from "./scope";

export function groundBrief(data: BriefInput, research: Research, resolveUrls = true) {
  if (research.schemaVersion !== 2 || !research.products || !research.assets) throw new WorkflowError("These legacy photos have not been classified. Research the product again before preparing a new brief.", 409);
  if (!research.campaign?.direction || research.campaign.status === "awaiting_direction") throw new WorkflowError("Choose a campaign direction before preparing a brief.", 409);
  const product = research.products.find(product => product.id === data.productId);
  const asset = research.assets.find(asset => asset.id === data.referenceAssetId);
  if (!product || !asset) throw new WorkflowError("Select a saved product ID and photo ID. Unknown references cannot be used.");
  if (!research.campaign.productIds.includes(product.id)) throw new WorkflowError("This product is outside the selected campaign.");
  const members = scopeForCampaign(research.campaign, research.products).members;
  if (!members.some(member => member.productId === product.id && (member.variantId === null || member.variantId === (data.variantId ?? null)))) throw new WorkflowError("This product or variant is outside the included campaign members.");
  if (research.campaign.selectedProductId !== product.id) throw new WorkflowError("Choose this product in the research panel before preparing its brief.");
  if (!asset.eligibleAsProductReference || !["product_photo", "product_lifestyle"].includes(asset.role) || !asset.productIds.includes(product.id) || !product.assetIds.includes(asset.id) || asset.classification !== "verified_structure") throw new WorkflowError("This image is not a Shopify-verified photo of the selected product. Choose a product with a valid Shopify gallery image.");
  const suppliedVariant = research.campaign.direction.url ? new URL(research.campaign.direction.url).searchParams.get("variant") : null;
  if (suppliedVariant && product.variants.find(variant => variant.storeId === suppliedVariant)?.id !== data.variantId) throw new WorkflowError("The supplied URL selects a specific variant. Choose its verified variant photo before preparing the brief.");
  if (data.variantId && (!product.variants.some(variant => variant.id === data.variantId) || !asset.variantIds.includes(data.variantId))) throw new WorkflowError("This photo does not establish the selected variant. Choose its verified photo or leave the variant unspecified.");
  if (data.logoAssetId) {
    const logo = research.assets.find(asset => asset.id === data.logoAssetId);
    if (!research.brandKit?.logoAssetIds.includes(data.logoAssetId) || logo?.role !== "logo" || !["verified_structure", "user_confirmed"].includes(logo.classification)) throw new WorkflowError("The selected logo is not a verified part of this saved brand kit.");
  }
  if (resolveUrls) { data.productUrl = product.canonicalUrl; data.referenceImage = asset.originalUrl; }
  if (data.saleId) {
    const offer = research.offers?.find(offer => offer.id === data.saleId);
    if (!offer || offer.eligibility !== "eligible" || !offer.productIds.includes(product.id) || Date.now() - Date.parse(offer.checkedAt) > 86400000 || (offer.endsAt && Date.parse(offer.endsAt) <= Date.now())) throw new WorkflowError("This offer is stale or its eligibility is unresolved. Recheck its source and confirm full terms, or choose no offer.");
    const sale = research.sales.find(sale => sale.id === data.saleId);
    if (!sale || sale.description !== offer.quote || canonicalUrl(sale.sourceUrl) !== canonicalUrl(offer.sourceUrl)) throw new WorkflowError("Offer terms no longer match the saved evidence.");
  }
  // Quantified/conditional claims belong to a complete evidence block, never free copy.
  if (/(?:\d\s*%|\b\d[\d,.]*\s*(?:customers|reviews|stars)|\b(?:free shipping|off everything|best.?seller|rated|first order|save\s+\$)|[$£€]\s*\d)/i.test(`${data.headline} ${data.cta}`)) throw new WorkflowError("Keep prices, discounts, ratings, and customer counts in a supported claim block. Use benefit-led headline and CTA copy.");
  return { product, asset };
}
