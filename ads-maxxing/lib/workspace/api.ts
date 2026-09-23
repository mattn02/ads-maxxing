import type { Brief, Session, Variant } from "@/lib/workflow/session-types";
export type CampaignSummary = { id: string; title: string; brandId?: string; purpose?: "brand_setup" | "campaign" };
import type { BrandSummary, BrandDetail, BrandEdits } from "@/lib/workflow/onboarding-contracts";
export type WorkflowAction =
  | { action: "generateCampaign"; requestId: string; source: import("@/lib/workflow/generation-contracts").GenerationSource }
  | { action: "continueCampaign"; requestId: string }
  | { action: "setCampaignScope"; members: import("@/lib/workflow/research/scope").CampaignMember[] }
  | { action: "selectCampaignMember"; productId: string; variantId: string | null }
  | { action: "generateCampaignMember"; requestId: string; productId: string; variantId: string | null }
  | { action: "confirmCampaignSetup"; requestId: string; productId: string; variantId: string | null; referenceAssetId: string; saleId: string | null; confirmOffer?: boolean }
  | { action: "changeAdOffer"; requestId: string; variantId: string; saleId: string | null; confirmOffer?: boolean }
  | { action: "refineAd"; requestId: string; variantId: string; feedback: string }
  | { action: "regenerateAd"; requestId: string; variantId: string }
  | { action: "retryCreative"; requestId: string; previousRequestId: string; briefId: string; acknowledgePossibleDuplicate?: boolean }
  | { action: "researchBrand"; operationId: string }
  | { action: "confirmOffer"; offerId: string; productId: string }
  | { action: "selectProduct"; productId: string }
  | { action: "correctAsset"; assetId: string; role: import("@/lib/workflow/research/contracts").ResearchAsset["role"]; productId?: string }
  | { action: "correctBrand"; field: "voice" | "audience" | "valueProposition"; value: string }
  | { action: "approveBrief" | "generateAd"; briefId: string }
  | { action: "reviseBrief"; brief: Brief }
  | { action: "approveAd" | "reviewAd"; variantId: string };
export async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
export const workspaceApi = {
  open: (id: string) => request<Session>(`/api/sessions/${id}`),
  create: (url: string, key: string) => request<Session>("/api/sessions", { action: "setup", url, key }),
  startCampaign: (brandId: string, key: string, setupId?: string) => request<Session>("/api/sessions", { action: "campaign", brandId, key, setupId }),
  brands: () => request<BrandSummary[]>("/api/brands"),
  brand: (id: string) => request<BrandDetail>(`/api/brands/${id}`),
  saveBrand: (id: string, revision: number, edits: BrandEdits) => request<BrandDetail>(`/api/brands/${id}`, { revision, edits }),
  list: () => request<CampaignSummary[]>("/api/sessions"),
  action: (id: string, action: WorkflowAction) =>
    request<Session>(`/api/sessions/${id}`, action),
};
export const statusLabels: Record<Variant["status"], string> = {
  pending_review: "Checking",
  review_failed: "Review unavailable",
  needs_changes: "Feedback ready",
  needs_human: "Feedback ready",
  reviewed: "Ready for your decision",
  approved: "Approved",
};
export function storeName(session: Session | null) {
  if (session?.research?.brandKit?.name) return session.research.brandKit.name;
  const url = session?.research?.sources[0]?.url;
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "Your brand";
  } catch {
    return "Your brand";
  }
}
export function groupVariants(variants: Variant[]) {
  const published = variants.filter(isPublishedVariant);
  const byId = new Map(published.map((v) => [v.id, v]));
  const groups = new Map<string, Variant[]>();
  for (const variant of published) {
    let root = variant;
    const seen = new Set([root.id]);
    while (
      root.brief.parentVariantId &&
      byId.has(root.brief.parentVariantId) &&
      !seen.has(root.brief.parentVariantId)
    ) {
      root = byId.get(root.brief.parentVariantId)!;
      seen.add(root.id);
    }
    groups.set(root.id, [...(groups.get(root.id) || []), variant]);
  }
  return [...groups.values()];
}

/** Every completed generation is user-visible; review findings are advisory. */
export function isPublishedVariant(variant: Variant) {
  return Boolean(variant.imageUrl);
}
