import type { Variant } from "./session-types";

/** Keep the browser and server aligned with the persisted acceptance contract. */
export function acceptanceIssue(variant: Variant): string | undefined {
  if (variant.status === "approved") return;
  if (variant.status === "review_failed") return "Retry review before accepting this ad. Your saved image is retained.";
  if (!["reviewed", "needs_human"].includes(variant.status) || !variant.review)
    return "Complete the review before accepting this ad.";
  if (!["pass", "needs_human"].includes(variant.review.verdict))
    return "Resolve the review findings, then review the revised ad before accepting it.";
  if (!variant.review.checks.length || variant.review.checks.some(check => check.passed !== true))
    return "The ad must pass its source, layout, and copy checks before acceptance.";
  if (!Number.isFinite(Date.parse(variant.review.createdAt)))
    return "Retry review to save a valid review timestamp before accepting this ad.";
}
