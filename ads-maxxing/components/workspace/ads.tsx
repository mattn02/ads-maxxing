/* eslint-disable @next/next/no-img-element -- Local outputs and real store reference images. */
import { useState } from "react";
import {
  DEFAULT_DESIGN,
  type DesignSpec,
} from "@/lib/workflow/creative/schema";
import { compatibleParent } from "@/lib/workflow/creative/reuse";
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
  const photos =
    session.research?.sources.flatMap((s) =>
      s.images.map((url) => ({ url, source: s.url, title: s.title })),
    ) || [];
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
            `Prepare an initial brief for campaign ${name}. Remember campaign name as a preference. Objective: ${direction}. Exact product page: ${selected.source}. Exact reference photo: ${selected.url}. Do not generate; wait for explicit brief approval.`,
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
    design: brief.design ?? { ...DEFAULT_DESIGN },
    tokens:
      brief.tokens ??
      (session.research ? resolveBrandTokens(session.research) : undefined),
  });
  const [dirty, setDirty] = useState(!brief.design || !brief.tokens);
  const parent = session.variants.find(
    (variant) => variant.id === draft.parentVariantId,
  );
  const canReuse = compatibleParent(draft, parent);
  const canFinish = !!brief.visualCheckpoint && !completedVariant;
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
            src={draft.referenceImage}
            alt="Exact product reference for this ad"
          />
          <Badge>Sourced product photo</Badge>
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
            <label htmlFor="visual-direction">Visual direction</label>
            <textarea
              id="visual-direction"
              maxLength={1000}
              value={draft.design.visualDirection}
              onChange={(event) =>
                updateDesign({ visualDirection: event.target.value })
              }
            />
            <label>
              <input
                type="checkbox"
                disabled={!canReuse && !draft.design.reuseVisualFromVariantId}
                checked={!!draft.design.reuseVisualFromVariantId}
                onChange={(event) =>
                  updateDesign({
                    reuseVisualFromVariantId: event.target.checked
                      ? parent!.id
                      : null,
                  })
                }
              />{" "}
              Reuse the parent’s saved visual
            </label>
            <p>
              {draft.design.reuseVisualFromVariantId
                ? canReuse
                  ? "Reuse saved visual · no fal generation charge. The composed ad will be reviewed again."
                  : "The selected visual is incompatible. Restore its photo/direction or turn reuse off and approve a new visual request."
                : "Generate a new visual · one fal request, followed by composition and review."}
            </p>
            <p>Font: bundled Geist fallback, not the brand’s actual font.</p>
          </fieldset>

          <label htmlFor="offer">Supported offer</label>
          <select
            id="offer"
            disabled={busy}
            value={draft.saleId || ""}
            onChange={(e) => update({ saleId: e.target.value || null })}
          >
            <option value="">No offer</option>
            {session.research?.sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.description}
              </option>
            ))}
          </select>
          <label htmlFor="reference-photo">Reference photo</label>
          <select
            id="reference-photo"
            value={draft.referenceImage}
            disabled={busy}
            onChange={(e) => {
              const source = session.research?.sources.find((s) =>
                s.images.includes(e.target.value),
              );
              update({
                referenceImage: e.target.value,
                productUrl: source?.url || draft.productUrl,
              });
            }}
          >
            {session.research?.sources.flatMap((s) =>
              s.images.map((url, i) => (
                <option key={`${s.url}-${i}`} value={url}>
                  {s.title} · photo {i + 1}
                </option>
              )),
            )}
          </select>
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
              The visual is saved. Finishing this creative will not call fal.
            </p>
          )}
          {brief.generationAttemptedAt && !canFinish && (
            <p className="notice">
              Generation was already attempted for this revision. Edit the brief
              or give feedback to create another.
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
    return (
      <>
        <Button onClick={() => select(null)}>← All ads</Button>
        <SectionHeading title={variant.brief.headline}>
          <Badge tone={variant.status === "approved" ? "success" : "neutral"}>
            {statusLabels[variant.status]}
          </Badge>
        </SectionHeading>
        <div className="ad-detail">
          <img
            className="ad-preview"
            src={variant.imageUrl}
            alt={variant.brief.headline}
          />
          <div>
            <div className="card">
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
