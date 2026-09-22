import type { UIMessage } from "ai";
import type { BriefInput, Findings, VisualReview } from "./schema";
import type { Generation, Product } from "./types";

export type Source = Product & {
  fetchedAt: string;
  colors: Record<string, string>;
};
export type Research = {
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
  generationAttemptedAt?: string;
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
  status: "pending_review" | "review_failed" | "needs_changes" | "needs_human" | "reviewed" | "approved";
  review?: Review;
  reviewError?: string;
};
export type Session = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
  lastError?: string;
  preferences: Record<string, string>;
  research?: Research;
  brief?: Brief;
  variants: Variant[];
  events: { at: string; action: string; status: "started" | "completed" | "failed"; detail?: string }[];
};
