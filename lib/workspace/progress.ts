import type { Session } from "../workflow/session-types";

export type ProgressState = "active" | "paused" | "needs_input" | "retry" | "failed" | "complete";
export type ProgressStep = { id: string; label: string; status: "complete" | "current" | "pending" };

/** Derive only milestones that belong to the currently authorized generation intent. */
export function campaignProgress(session: Session, busy: boolean, error: string) {
  const intent = session.researchState?.generationIntent;
  const next = session.nextAction;
  const currentBrief = intent?.briefId && session.brief?.id === intent.briefId ? session.brief : undefined;
  const currentVariant = intent?.briefId
    ? session.variants.find(item => item.id === intent.briefId || item.brief.id === intent.briefId)
    : undefined;
  const researchDone = !!intent?.researchId;
  const briefDone = !!currentBrief || !!currentVariant;
  const imageDone = currentBrief?.sceneCheckpoint?.state === "saved" || !!currentVariant;
  const reviewDone = next?.kind === "complete" && !!currentVariant;
  const stages = [
    { id: "research", label: "Research products", complete: researchDone },
    { id: "brief", label: "Prepare creative", complete: briefDone },
    { id: "image", label: "Create image", complete: imageDone },
    { id: "review", label: "Check and save", complete: reviewDone },
  ];
  const currentIndex = stages.findIndex(item => !item.complete);
  const steps: ProgressStep[] = stages.map((item, index) => ({
    id: item.id, label: item.label,
    status: item.complete ? "complete" : index === currentIndex ? "current" : "pending",
  }));
  const state: ProgressState = next?.kind === "needs_input" ? "needs_input"
    : next?.kind === "complete" && reviewDone ? "complete"
      : busy || session.operationActive ? "active"
        : next?.kind === "retry" ? "retry"
          : error ? "failed" : "paused";
  const stage = state === "needs_input" ? "Choose a product and photo"
    : currentIndex === 0 ? "Finding products and photos"
      : currentIndex === 1 ? "Preparing your creative"
        : currentIndex === 2 ? "Creating your image"
          : currentIndex === 3 ? "Checking and saving your ad" : "Your ad is ready";
  const currentEvents = intent?.authorizedAt
    ? session.events.filter(event => Date.parse(event.at) >= Date.parse(intent.authorizedAt))
    : [];
  const product = session.research?.products?.find(item => item.id === session.research?.campaign?.selectedProductId);
  const referenceAssetId = intent?.setup?.referenceAssetId;
  const chosenAsset = intent?.researchId === session.research?.id && referenceAssetId
    ? session.research?.assets?.find(asset => asset.id === referenceAssetId && asset.eligibleAsProductReference && !!product?.assetIds.includes(asset.id))
    : undefined;
  const imageUrl = currentBrief?.sourceAssetId ? `/api/assets/${currentBrief.sourceAssetId}` : chosenAsset?.originalUrl;
  const productImage = imageUrl
    ? { src: imageUrl, alt: `Original store photo for ${product?.title || "the selected product"}` }
    : undefined;
  return { state, stage, steps, currentEvents, productImage };
}
