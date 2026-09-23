/* eslint-disable @next/next/no-img-element -- Store source photos have arbitrary remote hosts. */
import { useState } from "react";
import type { WorkflowAction } from "@/lib/workspace/api";
import type { Session } from "@/lib/workflow/session-types";
import { Badge, Button, EmptyState, SectionHeading } from "./ui";
import "./onboarding.css";
export function ResearchView({ session, busy, create, action }: {
  session: Session; busy: boolean; create: () => void; action: (body: WorkflowAction) => Promise<unknown>;
}) {
  const research = session.research!;
  const awaiting = session.researchState?.stage === "awaiting_direction";
  const selected = research.campaign?.selectedProductId;
  const choosingProduct = session.researchState?.stage === "needs_selection" && !selected;
  const campaignProductIds = research.campaign?.productIds ? new Set(research.campaign.productIds) : null;
  const products = campaignProductIds ? (research.products || []).filter((product) => campaignProductIds.has(product.id)) : research.products || [];
  const run = research.runs?.at(-1);
  const excludedImages = research.assets?.filter((asset) => !asset.eligibleAsProductReference && asset.role !== "logo") || [];
  const provenance = (field: "voice" | "audience") => {
    const finding = research.brandKit?.[field];
    if (research.brandKit?.overrides[field]) return "Edited by you";
    if (!finding || finding.status === "not_found" || finding.status === "not_checked") return "Not found";
    if (finding.status === "failed") return "Unavailable";
    return finding.evidence?.origin === "observed" ? "Observed" : "Inferred";
  };
  return <div className="research-screen">
    <SectionHeading eyebrow="YOUR BRAND’S VIBE" title={research.brandKit?.name || "Your brand research"}><Badge>{awaiting ? "Choose a direction" : "Research findings"}</Badge></SectionHeading>
    <p className="research-intro">{awaiting ? "Your brand kit is saved. Choose what to promote and mattGPT will find the product photos." : research.campaign?.status === "needs_selection" ? "Choose the product to feature from this researched shortlist." : "Review the real product and its photo before preparing your ad."}</p>
    {awaiting && <section className="card research-next"><span className="eyebrow">NEXT STEP</span><h2>Choose what to promote</h2><p className="muted">Start with a store suggestion, your own idea, or a product URL.</p><Button primary onClick={create}>Choose a direction →</Button></section>}
    {!!products.length && <section aria-labelledby="research-products-title">
      <h2 id="research-products-title">{choosingProduct ? "Choose a product" : "Researched products"} <span className="muted">· {products.length}</span></h2>
      {choosingProduct && <p className="muted">Your choice determines which product photo the ad can use.</p>}
      <div className="source-grid">{products.map((product) => {
        const photos = research.assets?.filter((asset) => product.assetIds.includes(asset.id) && asset.eligibleAsProductReference) || [];
        return <article className="card source-card" key={product.id}>
          <div className="images">{photos.map((asset) => <img key={asset.id} src={asset.originalUrl} alt={`Source photo of ${product.title}`} loading="lazy" />)}</div>
          {!photos.length && <p className="notice">No verified Shopify gallery image was found for this product.</p>}
          <h3>{product.title}</h3><p>{product.description}</p>
          {product.price && <p className="small muted">{product.price.currency} {product.price.amount} · observed price</p>}
          <p className="small muted">{product.variants.length ? `${product.variants.length} evidenced variants` : "Variant not established; size or model will not be assumed."}</p>
          <div className="research-product-actions"><a href={product.canonicalUrl} target="_blank" rel="noreferrer">View source ↗</a><Button primary={choosingProduct && selected !== product.id} disabled={busy || selected === product.id} onClick={() => void action({ action: "selectProduct", productId: product.id })}>{selected === product.id ? "Selected product" : "Choose product →"}</Button></div>
        </article>;
      })}</div>
    </section>}
    {selected && <div className="card next-step"><div><h2>Product saved to your campaign</h2><p>Your real product photos are the starting point for the creative.</p></div><Button primary disabled={busy} onClick={create}>View campaign →</Button></div>}
    <section className="research-brand-notes" aria-labelledby="research-brand-notes-title"><h2 id="research-brand-notes-title">Brand notes</h2><div className="findings-grid">
      <div className="card"><Badge>{provenance("voice")}</Badge><h3>Voice</h3><p>{research.brandKit?.overrides.voice ?? research.brandKit?.voice.value ?? research.voice ?? "Not found"}</p></div>
      <div className="card"><Badge>{provenance("audience")}</Badge><h3>Audience</h3><p>{research.brandKit?.overrides.audience ?? research.brandKit?.audience.value ?? research.audience ?? "Not found"}</p></div>
    </div></section>
    <div className="research-evidence-group">
      <details className="card research-evidence"><summary>Offers and customer evidence</summary><p>Choose an offer at the product checkpoint, or use Change offer beside an existing ad. You’ll confirm its product and customer restrictions there.</p>{research.offers?.map((offer) => <p key={offer.id}>{offer.quote} <Badge>{offer.eligibility}</Badge><br /><a href={offer.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a> · checked {new Date(offer.checkedAt).toLocaleDateString()}</p>)}{!research.offers?.length && <p className="muted">No supported offer found. An evergreen product ad can still proceed.</p>}{research.customerEvidence?.map((item) => <p key={item.id}><Badge>{item.kind}</Badge> {item.value} · {item.productId ? "Product-scoped" : "Company-scoped"} <a href={item.evidence.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a></p>)}{!research.customerEvidence?.length && <p className="muted">No customer evidence found. No rating or testimonial will be invented.</p>}</details>
      <details className="card research-evidence"><summary>Excluded store images · {excludedImages.length}</summary><p className="muted">These images are visible for reference but cannot be used for generation because Shopify did not associate them with the product.</p><div className="asset-grid">{excludedImages.slice(0, 36).map((asset) => <div className="card asset" key={asset.id}><img src={asset.originalUrl} alt="Unsorted store image" loading="lazy" /><Badge>{asset.role}</Badge></div>)}</div></details>
      <details className="card research-evidence"><summary>Research coverage and sources</summary><p>{run ? `${run.scope} stage · ${run.status} · ${run.attemptedUrls.length} pages attempted · ${run.failedUrls.length} unavailable` : research.schemaVersion === 2 ? "Brand context saved. Choose a direction to begin product research." : "Legacy research: refresh a product before making a new brief."}</p>{research.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> · {new Date(source.fetchedAt).toLocaleString()}</p>)}</details>
    </div>
    {research.warnings.map((warning) => <p className="notice research-warning" key={warning}>{warning}</p>)}
  </div>;
}
export function BrandView({ session, action }: { session: Session | null; action: (body: WorkflowAction) => Promise<unknown> }) {
  const [field, setField] = useState<"voice" | "audience" | "valueProposition">("voice");
  const [value, setValue] = useState("");
  if (!session?.research) return <EmptyState title="Your brand, all in one place">Research a store to collect its palette, voice, and audience.</EmptyState>;
  const { research } = session; const kit = research.brandKit;
  return <><SectionHeading eyebrow="THE FOUNDATION" title="Brand kit"/>
    <div className="card"><h2>{kit?.name || "Store"}</h2>{kit && <a href={kit.canonicalStoreUrl} target="_blank" rel="noreferrer">Visit store ↗</a>}<p>{kit?.overrides.valueProposition || kit?.valueProposition.value || "No value proposition found."}</p>
      <div className="images">{research.assets?.filter(asset => kit?.logoAssetIds.includes(asset.id)).map(asset => <img key={asset.id} src={asset.originalUrl} alt="Observed brand logo" />)}</div>{!kit?.logoAssetIds.length && <p className="muted">No usable logo found. An ad can proceed without one.</p>}
    </div>
    <div className="findings-grid">{[["Voice", research.voice], ["Audience", research.audience]].map(([label, text]) => <div className="card" key={label}><Badge>{kit?.overrides[label.toLowerCase()] ? "User supplied" : "Inferred"}</Badge><h2>{label}</h2><p>{text}</p></div>)}</div>
    <div className="card"><h2>Semantic palette</h2><div className="palette">{(kit?.colors || research.colors.map(color => ({ ...color, role: "observed" }))).map((color, index) => <div key={index}><span style={{ backgroundColor: color.value }}/>{color.role} · {color.value}</div>)}</div><h3>Typography</h3><p>Heading: {kit?.typography.heading.value || "Not found"} · Body: {kit?.typography.body.value || "Not found"}</p><p className="muted">An exact supported family is selected when the brief is saved; otherwise the ad uses bundled Geist.</p></div>
    {kit && <form className="card" onSubmit={event => { event.preventDefault(); void action({ action: "correctBrand", field, value }); setValue(""); }}><h2>Correct your brand kit</h2><p>Saved corrections take priority when research is refreshed.</p><label htmlFor="brand-field">Field</label><select id="brand-field" value={field} onChange={event => setField(event.target.value as typeof field)}><option value="voice">Voice</option><option value="audience">Audience</option><option value="valueProposition">Value proposition</option></select><label htmlFor="brand-value">Your correction</label><textarea id="brand-value" required maxLength={2000} value={value} onChange={event => setValue(event.target.value)}/><Button>Save correction</Button></form>}
    <div className="card"><h2>Campaign preferences</h2>{Object.entries(session.preferences).map(([key, value]) => <p key={key}><strong>{key}</strong> · {value}</p>)}{!Object.keys(session.preferences).length && <p className="muted">Tell your creative partner your campaign preferences in chat.</p>}</div>
  </>;
}
