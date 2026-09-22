import type { Brief, Session, Variant } from "@/lib/workflow/session-types";
export type CampaignSummary = { id: string; title: string };
export type WorkflowAction =
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
  create: () => request<Session>("/api/sessions", {}),
  list: () => request<CampaignSummary[]>("/api/sessions"),
  action: (id: string, action: WorkflowAction) =>
    request<Session>(`/api/sessions/${id}`, action),
};
export const statusLabels: Record<Variant["status"], string> = {
  pending_review: "Checking",
  review_failed: "Review unavailable",
  needs_changes: "Changes needed",
  needs_human: "Needs your review",
  reviewed: "Ready for approval",
  approved: "Approved",
};
export function storeName(session: Session | null) {
  const url = session?.research?.sources[0]?.url;
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "Your brand";
  } catch {
    return "Your brand";
  }
}
export function groupVariants(variants: Variant[]) {
  const byId = new Map(variants.map((v) => [v.id, v]));
  const groups = new Map<string, Variant[]>();
  for (const variant of variants) {
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
