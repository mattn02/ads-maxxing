/* eslint-disable @next/next/no-img-element -- Local outputs and real store reference images. */
import { useState } from "react";
import {
  DEFAULT_DESIGN,
  CREATIVE_FONT_FAMILY,
  executionSummary,
  type DesignSpec,
} from "@/lib/workflow/creative/schema";
import type { Brief, Session, Variant } from "@/lib/workflow/session-types";
import {
  groupVariants,
  isPublishedVariant,
  statusLabels,
  type WorkflowAction,
} from "@/lib/workspace/api";
import { Badge, Button, EmptyState, SectionHeading } from "./ui";
import { OfferChoices, offerIssue } from "./offer-choices";
import { AdPreviewImage } from "./ad-preview-image";
import { AdSourceReference } from "./ad-source-reference";
import { formatProductPrice, selectedProductPrice } from "@/lib/workflow/research/prices";
import { acceptanceIssue, requiresReviewOverride } from "@/lib/workflow/review-acceptance";
export function CampaignForm({
  session,
  busy,
  send,
  cancel,
}: {
  session: Session;
  busy: boolean;
  send: (text: string) => void;
  cancel: () => void;
}) {
  const [name, setName] = useState("Evergreen product campaign");
  const [direction, setDirection] = useState("");
  const [photo, setPhoto] = useState("");
  const selectedProduct = session.research?.products?.find(product => product.id === session.research?.campaign?.selectedProductId);
  const photos = session.research?.assets?.filter(asset => asset.eligibleAsProductReference && asset.classification === "verified_structure" && asset.productIds.includes(selectedProduct?.id ?? ""))
    .map(asset => ({ id: asset.id, url: asset.originalUrl, source: selectedProduct!.canonicalUrl, title: selectedProduct!.title })) ?? [];
  return (
    <>
      <SectionHeading
        eyebrow="LET’S SET THE DIRECTION"
        title="Create a campaign"
      />
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          const selected = photos.find((p) => p.url === photo)!;
          send(
            `Prepare an initial brief for campaign ${name}. Remember campaign name as a preference. Objective: ${direction}. Product ID: ${selectedProduct!.id}. Reference asset ID: ${selected.id}. Exact product page: ${selected.source}. Exact reference photo: ${selected.url}. Do not generate; wait for explicit brief approval.`,
          );
          cancel();
        }}
      >
        <label htmlFor="campaign-name">Campaign name</label>
        <input
          id="campaign-name"
          required
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="objective">What do you want this ad to do?</label>
        <textarea
          id="objective"
          required
          value={direction}
          maxLength={2000}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="Introduce our best-selling product to new customers…"
        />
        <label htmlFor="campaign-photo">Product and reference photo</label>
        <select
          id="campaign-photo"
          required
          value={photo}
          onChange={(e) => setPhoto(e.target.value)}
        >
          <option value="">Choose a researched photo</option>
          {photos.map((p, i) => (
            <option key={`${p.source}-${i}`} value={p.url}>
              {p.title} · photo {i + 1}
            </option>
          ))}
        </select>
        {photo && (
          <img
            className="reference"
            src={photo}
            alt="Selected product reference"
          />
        )}
        <p className="muted small">
          Confirm this is the exact product you want to advertise. You’ll review
          the copy before generation.
        </p>
        {!photos.length && (
          <p className="notice">
            No product photos yet. Add a product URL in chat to continue.
          </p>
        )}
        <div className="actions">
          <Button type="button" onClick={cancel}>
            Cancel
          </Button>
          <Button primary disabled={busy || !photo}>
            Prepare brief →
          </Button>
        </div>
      </form>
    </>
  );
}
export function BriefEditor({
  session,
  busy,
  action,
}: {
  session: Session;
  busy: boolean;
  action: (a: WorkflowAction) => Promise<boolean>;
}) {
  const brief = session.brief!;
  const completedVariant = session.variants.find(
    (variant) => variant.brief.id === brief.id,
  );
  const [draft, setDraft] = useState({
    ...brief,
    parentVariantId: completedVariant?.id ?? brief.parentVariantId,
    design: brief.design?.version === 2 ? brief.design : structuredClone(DEFAULT_DESIGN),
    tokens: brief.tokens,
  });
  const [dirty, setDirty] = useState(brief.design?.version !== 2 || !brief.tokens);
  const researchedPrice = selectedProductPrice(session.research?.products?.find(product => product.id === draft.productId), draft.variantId);
  const formattedPrice = (() => {
    if (!researchedPrice) return null;
    try { return formatProductPrice(researchedPrice); }
    catch { return null; }
  })();
  const uncertain = brief.sceneCheckpoint?.state === "attempted" && !brief.sceneCheckpoint.provider;
  const canFinish = !uncertain && !!brief.sceneCheckpoint && !completedVariant;
  function updateDesign(values: Partial<DesignSpec>) {
    update({ design: { ...draft.design, ...values } });
  }
  function update(value: Partial<Brief>) {
    setDraft({ ...draft, ...value, design: value.design ?? draft.design });
    setDirty(true);
  }
  async function generate() {
    if (
      !brief.approvedAt &&
      !(await action({ action: "approveBrief", briefId: brief.id }))
    )
      return;
    await action({ action: "generateAd", briefId: brief.id });
  }
  return (
    <>
      <SectionHeading
        eyebrow="YOUR CREATIVE CHECKPOINT"
        title="Review your brief"
      >
        <Badge tone="warning">
          {dirty
            ? "Unsaved edits"
            : brief.approvedAt
              ? "Brief approved"
              : "Needs your approval"}
        </Badge>
      </SectionHeading>
      <div className="brief-layout">
        <div className="reference-panel">
          <img
            src={draft.referenceImage === brief.referenceImage && brief.sourceAssetId ? `/api/assets/${brief.sourceAssetId}` : draft.referenceImage}
            alt="Exact product reference for this ad"
          />
          <Badge>{brief.sourceAssetId && draft.referenceImage === brief.referenceImage ? "Saved original photo" : "Source photo needs saving"}</Badge>
          <a href={draft.productUrl} target="_blank" rel="noreferrer">
            View product ↗
          </a>
        </div>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void action({ action: "reviseBrief", brief: draft });
          }}
        >
          <label htmlFor="headline">Headline</label>
          <input
            id="headline"
            required
            maxLength={120}
            disabled={busy}
            value={draft.headline}
            onChange={(e) => update({ headline: e.target.value })}
          />
          <label htmlFor="cta">Call to action</label>
          <input
            id="cta"
            required
            maxLength={50}
            disabled={busy}
            value={draft.cta}
            onChange={(e) => update({ cta: e.target.value })}
          />
          <label htmlFor="direction">Creative direction</label>
          <textarea
            id="direction"
            required
            maxLength={2000}
            rows={5}
            disabled={busy}
            value={draft.direction}
            onChange={(e) => update({ direction: e.target.value })}
          />
          <fieldset disabled={busy}>
            <legend>Creative design</legend>
            <p className="muted small">The logo stays in the top-left, the headline stays at the top, and the image remains full-bleed behind them.</p>
            <label htmlFor="alignment">Alignment</label>
            <select
              id="alignment"
              value={draft.design.alignment}
              onChange={(event) =>
                updateDesign({
                  alignment: event.target.value as DesignSpec["alignment"],
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
            </select>
            <label htmlFor="headline-style">Headline emphasis</label>
            <select
              id="headline-style"
              value={draft.design.headlineStyle}
              onChange={(event) =>
                updateDesign({
                  headlineStyle: event.target
                    .value as DesignSpec["headlineStyle"],
                })
              }
            >
              <option value="standard">Standard</option>
              <option value="oversized">Oversized</option>
            </select>
            <label htmlFor="cta-style">CTA style</label>
            <select
              id="cta-style"
              value={draft.design.ctaStyle}
              onChange={(event) =>
                updateDesign({
                  ctaStyle: event.target.value as DesignSpec["ctaStyle"],
                })
              }
            >
              <option value="solid">Solid</option>
              <option value="outline">Outline · quieter</option>
            </select>
            <label htmlFor="background-direction">Setting and lighting</label>
            <textarea id="background-direction" maxLength={1000} value={draft.design.background.direction} onChange={event => updateDesign({ background: { direction: event.target.value } })} />
            <label htmlFor="scene-direction">Product pose and interaction</label>
            <textarea id="scene-direction" maxLength={1000} value={draft.design.scene.direction} onChange={event => updateDesign({ scene: { ...draft.design.scene, direction: event.target.value } })} />
            <label htmlFor="product-scale">Product prominence</label>
            <select id="product-scale" value={draft.design.scene.productScale} onChange={event => updateDesign({ scene: { ...draft.design.scene, productScale: event.target.value as "standard" | "large" } })}>
              <option value="standard">Standard</option><option value="large">Large</option>
            </select>
            <label htmlFor="variation">New variation</label>
            <select id="variation" value={draft.variation === "background" ? "scene" : draft.variation ?? "auto"} onChange={event => update({ variation: event.target.value as Brief["variation"] })}>
              <option value="auto">Reuse compatible complete scene</option><option value="scene">Generate a fresh complete scene</option>
            </select>
            <p className="notice">{dirty ? "Save edits to see the updated generation plan before approving." : executionSummary(brief.executionPlan)}</p>
            {!dirty && brief.executionPlan && <p className="muted small">{Number(brief.executionPlan.scene.action === "generate")} image generation {brief.executionPlan.scene.action === "generate" ? "call" : "calls"} planned. Copy is rendered exactly after generation.</p>}
            <p>Font: {CREATIVE_FONT_FAMILY}. Color emojis use Twemoji.</p>
          </fieldset>

          <label>Researched price</label>
          <p>{formattedPrice ?? "No verified price found — none will be shown."}</p>
          <label htmlFor="offer">Supported offer</label>
          <select
            id="offer"
            disabled={busy}
            value={draft.saleId || ""}
            onChange={(e) => update({ saleId: e.target.value || null })}
          >
            <option value="">No offer</option>
            {session.research?.offers?.filter(offer => offer.eligibility === "eligible" && offer.productIds.includes(draft.productId ?? "")).map(offer => <option key={offer.id} value={offer.id}>{offer.displayCopy}</option>)}
          </select>
          <label htmlFor="brand-logo">Brand logo</label>
          <select id="brand-logo" disabled={busy} value={draft.logoAssetId === null ? "" : draft.logoAssetId ?? session.research?.brandKit?.selectedLogoAssetId ?? ""} onChange={event => update({ logoAssetId: event.target.value || null })}>
            <option value="">No logo</option>
            {session.research?.assets?.filter(asset => asset.role === "logo" && session.research?.brandKit?.logoAssetIds.includes(asset.id)).map((asset, index) => <option key={asset.id} value={asset.id}>Verified brand logo {index + 1}</option>)}
          </select>
          <label htmlFor="reference-photo">Reference photo</label>
          <select id="reference-photo" value={draft.referenceAssetId ?? ""} disabled={busy} onChange={event => {
            const asset = session.research?.assets?.find(asset => asset.id === event.target.value);
            if (asset) update({ referenceAssetId: asset.id, referenceImage: asset.originalUrl });
          }}>
            {!draft.referenceAssetId && <option value="">Choose a verified product photo</option>}
            {session.research?.assets?.filter(asset => asset.eligibleAsProductReference && asset.classification === "verified_structure" && asset.productIds.includes(draft.productId ?? "")).map((asset, index) => <option key={asset.id} value={asset.id}>Shopify product photo {index + 1}</option>)}
          </select>
          <p className="muted small">To advertise another product, select it in Research first.</p>
          <p className="muted small">
            Editing saves a new revision and clears its approval. Existing ads
            stay intact.
          </p>
          <div className="actions">
            <Button disabled={busy || !dirty}>Save revised brief</Button>
            <Button
              type="button"
              primary
              disabled={
                busy ||
                dirty ||
                !!completedVariant ||
                (!!brief.generationAttemptedAt && !canFinish)
              }
              onClick={() => void generate()}
            >
              {busy
                ? "Working…"
                : canFinish
                  ? "Finish saved creative"
                  : brief.approvedAt
                    ? "Generate approved brief"
                    : "Approve brief & generate"}
            </Button>
          </div>
          {canFinish && (
            <p className="notice">
              Saved stages are retained. Continue from the next unfinished step; completed image requests are never repeated.
            </p>
          )}
          {brief.generationAttemptedAt && !canFinish && (
            <p className="notice">
              A request was attempted without a saved result. Its outcome may be unknown. Inspect saved events; a new paid attempt needs a new approved revision.
            </p>
          )}
        </form>
      </div>
    </>
  );
}
export function AdsView({
  session,
  selected,
  select,
  feedback,
  create,
  busy,
  action,
}: {
  session: Session;
  selected: string | null;
  select: (id: string | null) => void;
  feedback: (v: Variant) => void;
  create: () => void;
  busy: boolean;
  action: (a: WorkflowAction) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const groups = groupVariants(session.variants);
  const published = session.variants.filter(isPublishedVariant);
  const variant = published.find((v) => v.id === selected);
  if (variant) {
    const history = groups.find((g) => g.some((v) => v.id === variant.id)) || [
      variant,
    ];
    const versionNumber = history.findIndex((v) => v.id === variant.id) + 1;
    const overrideReview = requiresReviewOverride(variant);
    const acceptanceProblem = acceptanceIssue(variant, overrideReview);
    const canAccept = !acceptanceProblem;
    const criteria = variant.review ? [
      { label: "Product appearance", ...variant.review.visual.productFidelity },
      { label: "Text legibility", ...variant.review.visual.textLegibility },
      { label: "Claims", ...variant.review.visual.claimAccuracy },
      { label: "Brand fit", ...variant.review.visual.brandFit },
    ].filter((criterion) => criterion.status !== "pass") : [];
    return (
      <>
        <Button onClick={() => select(null)}>← All ads</Button>
        <SectionHeading title={variant.brief.headline}>
          <Badge tone={variant.status === "approved" ? "success" : "neutral"}>
            {variant.status === "approved" ? "Accepted" : statusLabels[variant.status]}
          </Badge>
        </SectionHeading>
        <div className="ad-detail">
          <div>
            <p className="muted small" aria-live="polite">
              Viewing Version {versionNumber} of {history.length}
            </p>
            <AdPreviewImage
              key={variant.id}
              frameClassName="ad-preview-frame"
              src={variant.imageUrl}
              alt={`Version ${versionNumber}: ${variant.brief.headline}`}
              priority
            />
            <AdSourceReference variant={variant} />
          </div>
          <div>
            <div className="card">
              <h2>{variant.status === "approved" ? "Ad accepted" : "Review your ad"}</h2>
              <p>
                {variant.review?.visual.summary ||
                  variant.reviewError ||
                  "The automated review is still pending."}
              </p>
              {criteria.map((criterion) => <p className="review-finding" key={criterion.label}><strong>{criterion.label} · {criterion.status === "uncertain" ? "Check this" : "Suggested change"}</strong><br />{criterion.reason}</p>)}
              {variant.review?.checks.filter((check) => !check.passed).map((check) => <p className="review-finding" key={check.name}><strong>{check.name}</strong><br />{check.detail}</p>)}
              <p className="muted small">
                {variant.acceptance ? `Accepted on ${new Date(variant.acceptance.acceptedAt).toLocaleString()}.${variant.acceptance.reviewOverridden ? " You overrode the reviewer’s recommendation." : ""} Automated feedback is kept with this version.` : acceptanceProblem || (overrideReview ? "The reviewer recommends changes. You can accept this ad anyway; its findings will stay saved with this version." : "Review any uncertain findings and accept this version, or refine it in chat.")}
              </p>
              <div className="actions">
                <Button
                  primary
                  disabled={busy || !canAccept || variant.status === "approved"}
                  onClick={() =>
                    void action({ action: "approveAd", variantId: variant.id, overrideReview })
                  }
                >
                  {variant.status === "approved" ? "Accepted ✓" : overrideReview ? "Accept anyway" : "Accept ad"}
                </Button>
                <Button disabled={busy} onClick={() => feedback(variant)}>Refine this ad →</Button>
                <Button
                  disabled={busy}
                  onClick={() => void action({ action: "regenerateAd", requestId: crypto.randomUUID(), variantId: variant.id })}
                >
                  Regenerate visual
                </Button>
                {(variant.status === "review_failed" || (acceptanceProblem && variant.status !== "pending_review")) && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void action({ action: "reviewAd", variantId: variant.id })
                    }
                  >
                    Retry review
                  </Button>
                )}
              </div>
              <a
                className="download"
                href={variant.imageUrl}
                download={`${variant.id}.png`}
              >
                Download image ↓
              </a>
              <details className="ad-review-evidence" open={variant.review?.verdict !== "pass"}>
                <summary>Review details</summary>
                {variant.review?.checks.map((check) => <p className="small" key={check.name}>{check.passed ? "✓" : "!"} <strong>{check.name}</strong> — {check.detail}</p>)}
              </details>
            </div>
            <ChangeOffer key={variant.id} variant={variant} session={session} busy={busy} action={action} />
            <div className="card">
              <h2>Version history</h2>
              {history.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={v.id === variant.id}
                  className={`version ${v.id === variant.id ? "active" : ""}`}
                  onClick={() => select(v.id)}
                >
                  Version {i + 1}
                  <span>{v.status === "approved" ? "Accepted" : statusLabels[v.status]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }
  const visible = groups.filter((g) => {
    const latest = g[g.length - 1];
    return (
      latest.brief.headline.toLowerCase().includes(query.toLowerCase()) &&
      (!filter || latest.status === filter)
    );
  });
  return (
    <>
      <SectionHeading eyebrow="IDEAS, READY TO GO PLACES" title="Your ads">
        <Button primary disabled={busy} onClick={create}>
          + Create ad
        </Button>
      </SectionHeading>
      <div className="toolbar">
        <input
          aria-label="Search ads"
          placeholder="Search your ads…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.entries(statusLabels).map(([s, label]) => (
            <option key={s} value={s}>
              {s === "approved" ? "Accepted" : label}
            </option>
          ))}
        </select>
        <span className="muted small">{visible.length} ads</span>
      </div>
      {!visible.length ? (
        <EmptyState
          title={
            published.length
              ? "No matching ads"
              : "Your first ad starts with a brief"
          }
        >
          {published.length
            ? "Try another search or status."
            : "Choose a product and a direction, then approve the brief to generate your first ad."}
        </EmptyState>
      ) : (
        <div className="ad-grid">
          {visible.map((group, index) => {
            const v = group[group.length - 1];
            return (
              <button
                className="ad-card"
                key={group[0].id}
                onClick={() => select(v.id)}
              >
                <AdPreviewImage
                  frameClassName="ad-thumbnail"
                  src={v.imageUrl}
                  alt={v.brief.headline}
                  priority={index === 0}
                />
                <div className="ad-caption">
                  <Badge tone={v.status === "approved" ? "success" : "neutral"}>
                    {v.status === "approved" ? "Accepted" : statusLabels[v.status]}
                  </Badge>
                  <h3>{v.brief.headline}</h3>
                  <p className="muted small">
                    9:16 portrait · {group.length}{" "}
                    {group.length === 1 ? "version" : "versions"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ChangeOffer({ variant, session, busy, action }: {
  variant: Variant;
  session: Session;
  busy: boolean;
  action: (value: WorkflowAction) => Promise<boolean>;
}) {
  const [saleId, setSaleId] = useState<string | null>(variant.brief.saleId ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const offers = session.research?.offers ?? [];
  const selectedOffer = offers.find((offer) => offer.id === saleId);
  const selectedOfferUnavailable = selectedOffer ? offerIssue(selectedOffer) : null;
  const currentOffer = (session.research?.offers ?? []).find((offer) => offer.id === variant.brief.saleId);
  return <details className="card ad-offer">
    <summary>Change offer{currentOffer ? ` · ${currentOffer.displayCopy}` : " · No offer"}</summary>
    <p className="small muted">Choose an offer for a new ad version. The current version stays available.</p>
    <OfferChoices offers={offers} name={`offer-${variant.id}`} saleId={saleId} setSaleId={setSaleId} confirmed={confirmed} setConfirmed={setConfirmed} busy={busy || submitting} label="Offers for this ad" />
    <Button disabled={busy || submitting || saleId === (variant.brief.saleId ?? null) || (!!saleId && (!confirmed || !!selectedOfferUnavailable))} onClick={async () => {
      if (saleId === (variant.brief.saleId ?? null) || (saleId && (!confirmed || selectedOfferUnavailable))) return;
      setSubmitting(true);
      try { await action({ action: "changeAdOffer", requestId: crypto.randomUUID(), variantId: variant.id, saleId, ...(saleId ? { confirmOffer: true } : {}) }); }
      finally { setSubmitting(false); }
    }}>{submitting ? "Creating version…" : "Create version with this offer →"}</Button>
  </details>;
}
