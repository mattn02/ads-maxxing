import type { Research } from "../session-types";
import { pageHint } from "./extract";

/** Reuse company observations in another campaign without importing its product choices. */
export function adoptBrandContext(saved: Research): Research {
  const brand = structuredClone(saved);
  brand.sources = brand.sources.filter(source => ["home", "company"].includes(pageHint(source.url)));
  brand.products = []; brand.assets = brand.assets?.filter(asset => asset.role === "logo");
  brand.sales = []; brand.offers = []; brand.customerEvidence = brand.customerEvidence?.filter(item => item.productId === null);
  if (brand.campaign) brand.campaign = { direction: null, brandRevision: brand.brandKit?.revision || 1, productIds: [], selectedProductId: null, status: "awaiting_direction" };
  brand.runs = []; brand.warnings = [];
  return brand;
}
