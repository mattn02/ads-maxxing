import { randomUUID } from "node:crypto";
import type { Research } from "../session-types";
import { pageHint } from "./extract";

/** Reuse company observations in another campaign without importing its product choices. */
export function adoptBrandContext(saved: Research): Research {
  const brand = effectiveBrandResearch(saved);
  brand.id = randomUUID();
  brand.sources = brand.sources.filter(source => ["home", "company"].includes(pageHint(source.url)));
  brand.products = []; brand.assets = brand.assets?.filter(asset => asset.role === "logo");
  brand.sales = []; brand.offers = []; brand.customerEvidence = brand.customerEvidence?.filter(item => item.productId === null);
  if (brand.campaign) brand.campaign = { direction: null, brandRevision: brand.brandKit?.revision || 1, productIds: [], selectedProductId: null, status: "awaiting_direction" };
  brand.runs = []; brand.warnings = [];
  return brand;
}

/** Resolve overrides on a copy; observations in the canonical snapshot remain intact. */
export function effectiveBrandResearch(saved: Research): Research {
  const next = structuredClone(saved);
  const kit = next.brandKit;
  if (!kit) return next;
  kit.name = kit.overrides.name ?? kit.name;
  next.voice = kit.overrides.voice ?? kit.voice.value ?? "Not found";
  next.audience = kit.overrides.audience ?? kit.audience.value ?? "Not found";
  if (kit.visualOverrides?.colors) kit.colors = kit.visualOverrides.colors.map(color => ({ ...color, evidence: { sourceUrl: kit.canonicalStoreUrl, quote: "Owner corrected palette", method: "user", origin: "user_supplied" } }));
  if (kit.visualOverrides && "selectedLogoAssetId" in kit.visualOverrides) kit.selectedLogoAssetId = kit.visualOverrides.selectedLogoAssetId ?? null;
  next.colors = kit.colors.map(color => ({ value: color.value, sourceUrl: color.evidence.sourceUrl }));
  return next;
}
