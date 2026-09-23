import type { BrandTokens, VisualAsset, ExecutionPlan, StageCheckpoint } from "./creative/schema";
import type { UIMessage } from "ai";
import type { BriefInput, Findings, VisualReview } from "./schema";
import type { Generation, Product } from "./types";

import type { ResearchState, ResearchV2Fields } from "./research/contracts";

export type Source = Product & {
  requestedUrl?: string;
  finalUrl?: string;
  rawHtml?: string;
  shopify?: { url: string; fetchedAt: string; product: Record<string, unknown>; currency?: { code: string; sourceUrl: string; fetchedAt: string } };
  links?: string[];
  branding?: Record<string, unknown>;
  pageType?: "home" | "product" | "collection" | "company" | "unknown";
  providerUsage?: number;
  fetchedAt: string;
  colors: Record<string, string>;
};
export type Research = Partial<ResearchV2Fields> & {
  id: string;
  sources: Source[];
  colors: { value: string; sourceUrl: string }[];
  voice: string;
  audience: string;
  sales: (Findings["sales"][number] & { id: string })[];
  warnings: string[];
};
export type Brief = BriefInput & {
  id: string;
  researchId: string;
  approvedAt?: string;
  approvalOrigin?: "user_brief" | "campaign_generate";
  retryOfBriefId?: string;
  generationAttemptedAt?: string;
  tokens?: BrandTokens;
  visualCheckpoint?: VisualAsset; // Read-only legacy checkpoint.
  sourceAssetId?: string;
  logoSourceAssetId?: string;
  executionPlan?: ExecutionPlan;
  backgroundCheckpoint?: StageCheckpoint;
  sceneCheckpoint?: StageCheckpoint;
};
export type CodeCheck = { name: string; passed: boolean; detail: string };
export type Review = {
  verdict: "pass" | "needs_changes" | "needs_human";
  checks: CodeCheck[];
  visual: VisualReview;
  createdAt: string;
};
export type Variant = Generation & {
  brief: Brief;
  research: Research;
  /** New creative requests stay hidden until this attempt receives a full pass. */
  internalAttempt?: { requestId: string; number: 1 | 2 };
  status: "pending_review" | "review_failed" | "needs_changes" | "needs_human" | "reviewed" | "approved";
  review?: Review;
  reviewError?: string;
  acceptance?: { acceptedAt: string; reviewedAt: string; reviewOverridden?: boolean };
};
export type Session = {
  nextAction?: import("./generation-contracts").NextAction;
  purpose?: "brand_setup" | "campaign";
  brandId?: string;
  setup?: import("./onboarding-contracts").BrandSetup;
  leaseExpiresAt?: string;
  operationActive?: boolean;
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
  lastError?: string;
  preferences: Record<string, string>;
  research?: Research;
  researchState?: ResearchState;
  brief?: Brief;
  variants: Variant[];
  events: { at: string; action: string; status: "started" | "completed" | "failed"; detail?: string }[];
};
