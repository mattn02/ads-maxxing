/* eslint-disable @next/next/no-img-element -- Saved source assets are served from our asset route. */
import type { Variant } from "@/lib/workflow/session-types";

export function AdSourceReference({ variant }: { variant: Variant }) {
  return <div className="ad-source-reference">
    <img src={variant.sourceAssetId ? `/api/assets/${variant.sourceAssetId}` : variant.referenceImage} alt="Original product photo used for this ad" loading="lazy" />
    <div>
      <strong>Original product photo</strong>
      <p>Compare shape, color, branding, and details against the creative above.</p>
      <a href={variant.brief.productUrl} target="_blank" rel="noreferrer">View product at store ↗</a>
    </div>
  </div>;
}
