import type { Variant } from "./session-types";

/** Findings stay advisory; bypassing them requires an explicit human decision. */
export function requiresReviewOverride(variant: Variant): boolean {
  return !!variant.review && (variant.review.verdict === "needs_changes" || variant.review.checks.some(check => check.passed === false));
}

/** Keep the browser and server aligned with the persisted acceptance contract. */
export function acceptanceIssue(variant: Variant, overrideReview = false): string | undefined {
  if (variant.status === "approved") return;
  if (variant.status === "review_failed") return "Retry review before accepting this ad. Your saved image is retained.";
  if (!["reviewed", "needs_human", "needs_changes"].includes(variant.status) || !variant.review)
    return "Complete the review before accepting this ad.";
  if (!["pass", "needs_human", "needs_changes"].includes(variant.review.verdict))
    return "Retry review before accepting this ad.";
  if (requiresReviewOverride(variant) && !overrideReview)
    return "Resolve the review findings, or choose Accept anyway to override the reviewer's recommendation.";
  if (!variant.review.checks.length || variant.review.checks.some(check => typeof check.passed !== "boolean"))
    return "Retry review to save complete source, layout, and copy checks before accepting this ad.";
  if (!Number.isFinite(Date.parse(variant.review.createdAt)))
    return "Retry review to save a valid review timestamp before accepting this ad.";
}
