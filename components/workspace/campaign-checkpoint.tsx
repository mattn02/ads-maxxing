"use client";
/* eslint-disable @next/next/no-img-element -- Researched store photos have arbitrary remote hosts. */
import { useId, useState } from "react";
import type { Session } from "@/lib/workflow/session-types";
import type { WorkflowAction } from "@/lib/workspace/api";
import { memberReferenceReadiness, scopeForCampaign, type CampaignMember } from "@/lib/workflow/research/scope";
import { Button } from "./ui";
import { OfferChoices, offerIssue } from "./offer-choices";
import "./checkpoint.css";

export function CampaignCheckpoint({ session, busy, action }: {
  session: Session;
  busy: boolean;
  action: (value: WorkflowAction) => Promise<boolean>;
}) {
  const headingId = useId();
  const research = session.research;
  const products = research?.products ?? [];
  const assets = research?.assets ?? [];
  const members = research?.campaign ? scopeForCampaign(research.campaign, products).members : [];
  const initial = members.find((member) => member.productId === research?.campaign?.selectedProductId && member.variantId === (research?.campaign?.selectedVariantId ?? null) && memberReferenceReadiness(member, products, assets).status === "ready")
    ?? members.find((member) => memberReferenceReadiness(member, products, assets).status === "ready")
    ?? members[0];
  const [memberKey, setMemberKey] = useState(initial ? `${initial.productId}:${initial.variantId ?? ""}` : "");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const member = members.find((item) => `${item.productId}:${item.variantId ?? ""}` === memberKey) ?? initial;
  const product = products.find((item) => item.id === member?.productId);
  const photoIds = member ? memberReferenceReadiness(member, products, assets).referenceAssetIds : [];
  const photos = photoIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is NonNullable<typeof asset> => !!asset);
  const selectedPhoto = photos.find((photo) => photo.id === photoId) ?? photos[0];
  const offers = product ? (research?.offers ?? []) : [];
  const selectedOffer = offers.find((offer) => offer.id === saleId);
  const selectedOfferUnavailable = selectedOffer ? offerIssue(selectedOffer) : null;
  const intentId = session.researchState?.generationIntent?.requestId;

  function choose(member: CampaignMember) {
    setMemberKey(`${member.productId}:${member.variantId ?? ""}`);
    setPhotoId(null);
    setSaleId(null);
    setConfirmed(false);
  }

  return <section className="campaign-checkpoint card" aria-labelledby={headingId}>
    <span className="eyebrow">REVIEW YOUR AD SETUP</span>
    <h2 id={headingId}>Choose what goes in your ad</h2>
    <p className="muted">Review the product photo and optional offer. We’ll build the ad from these choices.</p>
    <div className="checkpoint-section">
      <h3>Product</h3>
      <div className="checkpoint-choices" role="group" aria-label="Campaign products and options">
        {members.map((item) => {
          const listedProduct = products.find((candidate) => candidate.id === item.productId);
          if (!listedProduct) return null;
          const listedOption = listedProduct.variants.find((candidate) => candidate.id === item.variantId);
          const ready = memberReferenceReadiness(item, products, assets).status === "ready";
          const key = `${item.productId}:${item.variantId ?? ""}`;
          const thumbnailId = memberReferenceReadiness(item, products, assets).referenceAssetIds[0];
          const thumbnail = assets.find((asset) => asset.id === thumbnailId);
          return <button key={key} type="button" className={`checkpoint-choice ${memberKey === key ? "is-selected" : ""}`} aria-pressed={memberKey === key} disabled={busy || submitting} onClick={() => choose(item)}>
            {thumbnail && <img className="checkpoint-product-thumbnail" src={thumbnail.originalUrl} alt="" loading="lazy" />}
            <strong>{listedProduct.title}</strong>
            {listedOption && <small>{listedOption.title}</small>}
            <small>{ready ? "Photo ready" : "Needs an exact photo"}</small>
          </button>;
        })}
      </div>
    </div>
    <div className="checkpoint-section">
      <h3>Product photo</h3>
      {photos.length ? <div className="checkpoint-choices" role="group" aria-label="Verified product photos">
        {photos.map((photo, index) => <button key={photo.id} type="button" className={`checkpoint-photo ${selectedPhoto?.id === photo.id ? "is-selected" : ""}`} aria-pressed={selectedPhoto?.id === photo.id} disabled={busy || submitting} onClick={() => setPhotoId(photo.id)}>
          <img src={photo.originalUrl} alt={`${product?.title ?? "Product"} photo ${index + 1}`} loading="lazy" />
          <span>Photo {index + 1}</span>
        </button>)}
      </div> : <p className="notice">No verified photo is available for this exact product option. Choose another product or option.</p>}
    </div>
    <div className="checkpoint-section">
      <h3>Offer <span className="muted small">Optional</span></h3>
      <OfferChoices offers={offers} name={`${headingId}-offer`} saleId={saleId} setSaleId={setSaleId} confirmed={confirmed} setConfirmed={setConfirmed} busy={busy || submitting} label="Offers for this ad" />
    </div>
    <div className="checkpoint-submit"><Button primary disabled={busy || submitting || !intentId || !member || !selectedPhoto || (!!saleId && (!confirmed || !!selectedOfferUnavailable))} onClick={async () => {
      if (!intentId || !member || !selectedPhoto || (saleId && (!confirmed || selectedOfferUnavailable))) return;
      setSubmitting(true);
      try { await action({ action: "confirmCampaignSetup", requestId: intentId, productId: member.productId, variantId: member.variantId, referenceAssetId: selectedPhoto.id, saleId, ...(saleId ? { confirmOffer: true } : {}) }); }
      finally { setSubmitting(false); }
    }}>{submitting ? "Creating your ad…" : "Generate ad →"}</Button></div>
  </section>;
}
