/* eslint-disable @next/next/no-img-element -- Local outputs and real store reference images. */
import { useState } from "react";
import {
  DEFAULT_DESIGN,
  executionSummary,
  type DesignSpec,
} from "@/lib/workflow/creative/schema";
import { resolveBrandTokens } from "@/lib/workflow/creative/tokens";
import type { Brief, Session, Variant } from "@/lib/workflow/session-types";
import {
  groupVariants,
  statusLabels,
  type WorkflowAction,
} from "@/lib/workspace/api";
import { Badge, Button, EmptyState, SectionHeading } from "./ui";
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
  const photos = session.research?.assets?.filter(asset => asset.eligibleAsProductReference && asset.productIds.includes(selectedProduct?.id ?? ""))
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
    tokens:
      brief.tokens ??
      (session.research ? resolveBrandTokens(session.research) : undefined),
  });
  const [dirty, setDirty] = useState(brief.design?.version !== 2 || !brief.tokens);
  const uncertain = [brief.backgroundCheckpoint, brief.sceneCheckpoint].some(c => c?.state === "attempted" && !c.provider);
  const canFinish = !uncertain && !!(brief.backgroundCheckpoint || brief.sceneCheckpoint) && !completedVariant;
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
          <Badge>{brief.sourceAssetId ? "Saved original photo" : "Source photo needs saving"}</Badge>
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
            <label htmlFor="template">Template</label>
            <select
              id="template"
              value={draft.design.template}
              onChange={(event) =>
                updateDesign({
                  template: event.target.value as DesignSpec["template"],
                })
              }
            >
              <option value="copy-top">Copy above photo</option>
              <option value="photo-top">Photo above copy</option>
            </select>
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
            <select id="variation" value={draft.variation ?? "auto"} onChange={event => update({ variation: event.target.value as Brief["variation"] })}>
              <option value="auto">Reuse compatible saved images</option><option value="scene">Another product scene</option><option value="background">Another background and scene</option>
            </select>
            <p className="notice">{dirty ? "Save edits to see the updated generation plan before approving." : executionSummary(brief.executionPlan)}</p>
            {!dirty && brief.executionPlan && <p className="muted small">{Number(brief.executionPlan.background.action === "generate") + Number(brief.executionPlan.scene.action === "generate")} image generation calls planned. Copy is rendered exactly after generation.</p>}
            <p>Font: bundled Geist fallback, not the brand’s actual font. Color emojis use Twemoji.</p>
          </fieldset>

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
            {session.research?.assets?.filter(asset => asset.eligibleAsProductReference && asset.productIds.includes(draft.productId ?? "")).map((asset, index) => <option key={asset.id} value={asset.id}>Product photo {index + 1} · {asset.role.replaceAll("_", " ")}</option>)}
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
  const variant = session.variants.find((v) => v.id === selected);
  if (variant) {
    const history = groups.find((g) => g.some((v) => v.id === variant.id)) || [
      variant,
    ];
    const versionNumber = history.findIndex((v) => v.id === variant.id) + 1;
    return (
      <>
        <Button onClick={() => select(null)}>← All ads</Button>
        <SectionHeading title={variant.brief.headline}>
          <Badge tone={variant.status === "approved" ? "success" : "neutral"}>
            {statusLabels[variant.status]}
          </Badge>
        </SectionHeading>
        <div className="ad-detail">
          <div>
            <p className="muted small" aria-live="polite">
              Viewing Version {versionNumber} of {history.length}
            </p>
            <img
              key={variant.id}
              className="ad-preview"
              src={variant.imageUrl}
              alt={`Version ${versionNumber}: ${variant.brief.headline}`}
            />
            {variant.brief.executionPlan && <p className="muted small">{executionSummary(variant.brief.executionPlan)}</p>}
          </div>
          <div>
            <div className="card">
              <h2>Compare with the original</h2>
              <img className="reference" src={variant.sourceAssetId ? `/api/assets/${variant.sourceAssetId}` : variant.referenceImage} alt="Saved original product for fidelity comparison" />
              <p className="muted small">Check print, contour, openings, defining details and natural contact. Generation can alter product details.</p>
              <h2>Review findings</h2>
              <p>
                {variant.review?.visual.summary ||
                  variant.reviewError ||
                  "The automated review is still pending."}
              </p>
              {variant.review?.checks.map((c) => (
                <p key={c.name} className="small">
                  {c.passed ? "✓" : "!"} <strong>{c.name}</strong> — {c.detail}
                </p>
              ))}
              <p className="muted small">
                Automated checks are separate from your final approval.
              </p>
              <div className="actions">
                <Button onClick={() => feedback(variant)}>Give feedback</Button>
                <Button
                  primary
                  disabled={busy || variant.status !== "reviewed"}
                  onClick={() =>
                    void action({ action: "approveAd", variantId: variant.id })
                  }
                >
                  {variant.status === "approved" ? "Approved ✓" : "Approve ad"}
                </Button>
                {variant.status === "review_failed" && (
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
            </div>
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
                  <span>{statusLabels[v.status]}</span>
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
              {label}
            </option>
          ))}
        </select>
        <span className="muted small">{visible.length} ads</span>
      </div>
      {!visible.length ? (
        <EmptyState
          title={
            session.variants.length
              ? "No matching ads"
              : "Your first ad starts with a brief"
          }
        >
          {session.variants.length
            ? "Try another search or status."
            : "Choose a product and a direction, then approve the brief to generate your first ad."}
        </EmptyState>
      ) : (
        <div className="ad-grid">
          {visible.map((group) => {
            const v = group[group.length - 1];
            return (
              <button
                className="ad-card"
                key={group[0].id}
                onClick={() => select(v.id)}
              >
                <div className="ad-thumbnail">
                  <img src={v.imageUrl} alt={v.brief.headline} loading="lazy" />
                </div>
                <div className="ad-caption">
                  <Badge tone={v.status === "approved" ? "success" : "neutral"}>
                    {statusLabels[v.status]}
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
