"use client";
/* eslint-disable @next/next/no-img-element -- Source photos use store image URLs. */
import { useState } from "react";
import type { Brief, Session } from "@/lib/workflow/session-types";
import { DEFAULT_DESIGN, type DesignSpec } from "@/lib/workflow/creative/schema";
import { compatibleParent } from "@/lib/workflow/creative/reuse";
import { resolveBrandTokens } from "@/lib/workflow/creative/tokens";

export function BriefEditor({ brief, session, busy, action, generate }: { brief: Brief; session: Session; busy: boolean; action: (body: unknown) => Promise<void>; generate: () => void }) {
  const completedVariant = session.variants.find(variant => variant.brief.id === brief.id);
  const [draft, setDraft] = useState({ ...brief, parentVariantId: completedVariant?.id ?? brief.parentVariantId, design: brief.design ?? { ...DEFAULT_DESIGN }, tokens: brief.tokens ?? (session.research ? resolveBrandTokens(session.research) : undefined) });
  const [dirty, setDirty] = useState(!brief.design || !brief.tokens);
  function update(values: Partial<Brief>) { setDraft({ ...draft, ...values, design: values.design ?? draft.design }); setDirty(true); }
  function updateDesign(values: Partial<DesignSpec>) { update({ design: { ...draft.design, ...values } }); }
  const parent = session.variants.find(variant => variant.id === draft.parentVariantId);
  const canReuse = compatibleParent(draft, parent);
  const completed = session.variants.some(variant => variant.brief.id === brief.id);
  const canFinish = !!brief.visualCheckpoint && !completed;
  return <section>
    <h2>Brief · {!brief.design || !brief.tokens ? "save and approve the added design" : brief.approvedAt ? "approved" : "awaiting your approval"}</h2>
    <p>Confirm the photo is the exact product being advertised. Editing creates a new revision that needs approval.</p>
    <div className="images">{session.research?.sources.flatMap(source => source.images.map(image => <button key={`${source.url}:${image}`} disabled={busy} aria-pressed={draft.referenceImage === image} onClick={() => update({ referenceImage: image, productUrl: source.url })}>
      <img src={image} alt={`Select photo from ${source.title}`} loading="lazy" />
    </button>))}</div>
    <img className="reference" src={draft.referenceImage} alt="Selected source product" />
    <label htmlFor="headline">Headline</label><input id="headline" disabled={busy} maxLength={120} value={draft.headline} onChange={event => update({ headline: event.target.value })} />
    <label htmlFor="cta">Call to action</label><input id="cta" disabled={busy} maxLength={50} value={draft.cta} onChange={event => update({ cta: event.target.value })} />
    <label htmlFor="direction">Art direction</label><textarea id="direction" disabled={busy} maxLength={2000} value={draft.direction} onChange={event => update({ direction: event.target.value })} />
    <fieldset disabled={busy}>
      <legend>Creative design</legend>
      <label htmlFor="template">Template</label><select id="template" value={draft.design.template} onChange={event => updateDesign({ template: event.target.value as DesignSpec["template"] })}>
        <option value="copy-top">Copy above photo</option><option value="photo-top">Photo above copy</option>
      </select>
      <label htmlFor="alignment">Alignment</label><select id="alignment" value={draft.design.alignment} onChange={event => updateDesign({ alignment: event.target.value as DesignSpec["alignment"] })}>
        <option value="left">Left</option><option value="center">Center</option>
      </select>
      <label htmlFor="headline-style">Headline emphasis</label><select id="headline-style" value={draft.design.headlineStyle} onChange={event => updateDesign({ headlineStyle: event.target.value as DesignSpec["headlineStyle"] })}>
        <option value="standard">Standard</option><option value="oversized">Oversized</option>
      </select>
      <label htmlFor="cta-style">CTA style</label><select id="cta-style" value={draft.design.ctaStyle} onChange={event => updateDesign({ ctaStyle: event.target.value as DesignSpec["ctaStyle"] })}>
        <option value="solid">Solid</option><option value="outline">Outline · quieter</option>
      </select>
      <label htmlFor="visual-direction">Visual direction</label><textarea id="visual-direction" maxLength={1000} value={draft.design.visualDirection} onChange={event => updateDesign({ visualDirection: event.target.value })} />
      <label><input type="checkbox" disabled={!canReuse && !draft.design.reuseVisualFromVariantId} checked={!!draft.design.reuseVisualFromVariantId} onChange={event => updateDesign({ reuseVisualFromVariantId: event.target.checked ? parent!.id : null })} /> Reuse the parent’s saved visual</label>
      <p>{draft.design.reuseVisualFromVariantId ? canReuse ? "Reuse saved visual · no fal generation charge. The composed ad will be reviewed again." : "The selected visual is incompatible. Restore its photo/direction or turn reuse off and approve a new visual request." : "Generate a new visual · one fal request, followed by composition and review."}</p>
      <p>Font: bundled Geist fallback, not the brand’s actual font. Color emojis use Twemoji.</p>
    </fieldset>
    <label htmlFor="sale">Offer</label><select id="sale" disabled={busy} value={draft.saleId || ""} onChange={event => update({ saleId: event.target.value || null })}>
      <option value="">No offer</option>{session.research?.sales.map(sale => <option key={sale.id} value={sale.id}>{sale.description}</option>)}
    </select>
    {canFinish && <p>The visual is saved. Finishing this creative will not call fal.</p>}
    <details><summary>Saved design and visual checkpoint</summary><pre>{JSON.stringify({ design: brief.design, tokens: brief.tokens, visualAssetId: brief.visualCheckpoint?.id }, null, 2)}</pre></details>
    <p>Feedback: {brief.feedback || "First draft"}</p>
    <button disabled={busy || !dirty} onClick={() => void action({ action: "reviseBrief", brief: draft })}>Save revised brief</button>{" "}
    <button disabled={busy || dirty || !!brief.approvedAt || !!brief.generationAttemptedAt} onClick={() => void action({ action: "approveBrief", briefId: brief.id })}>Approve brief and photo</button>{" "}
    <button disabled={busy || dirty || !brief.approvedAt || completed || (!!brief.generationAttemptedAt && !canFinish)} onClick={generate}>{canFinish ? "Finish saved creative" : "Generate approved brief"}</button>
    {brief.generationAttemptedAt && !canFinish && <p>This revision has already attempted generation. Give feedback or save an edited brief to create another.</p>}
  </section>;
}
