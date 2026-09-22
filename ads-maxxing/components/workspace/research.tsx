/* eslint-disable @next/next/no-img-element -- Store source photos have arbitrary remote hosts. */
import { useState } from "react";
import type { WorkflowAction } from "@/lib/workspace/api";
import type { Session } from "@/lib/workflow/session-types";
import { Badge, Button, EmptyState, SectionHeading } from "./ui";
export function Onboarding({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (text: string) => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <div className="onboarding">
      <div className="eyebrow">YOUR NEXT GREAT AD STARTS HERE</div>
      <h1>
        A little research.
        <br />A lot of possibility.
      </h1>
      <p className="intro">
        Turn your store into a creative starting point.
        <br />
        We’ll get to know your brand and find your real product photos.
      </p>
      <form
        className="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(
            `Research ${url}. Save findings and wait for my next instruction. Do not generate an ad.`,
          );
        }}
      >
        <label htmlFor="store-url">Store or product URL</label>
        <div className="url-row">
          <input
            id="store-url"
            type="url"
            required
            placeholder="https://your-store.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <Button primary disabled={busy}>
            {busy ? "Researching…" : "Research brand →"}
          </Button>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => setUrl("https://www.loopycases.com")}
        >
          Try with Loopy Cases ↗
        </button>
      </form>
      <div className="steps">
        {[
          [
            "01",
            "Get to know your brand",
            "Products, imagery, and what makes you different.",
          ],
          [
            "02",
            "Choose your direction",
            "Shape a brief together before anything is generated.",
          ],
          [
            "03",
            "Make it your own",
            "Review, refine, and approve your next ad.",
          ],
        ].map(([n, title, text]) => (
          <div key={n}>
            <span>{n}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <p className="fine-print">
        Your approval comes before image generation. Always.
      </p>
    </div>
  );
}
export function ResearchView({ session, busy, send, create, action }: {
  session: Session; busy: boolean; send: (text: string) => void; create: () => void; action: (body: WorkflowAction) => Promise<unknown>;
}) {
  const [direction, setDirection] = useState("");
  const research = session.research!;
  const awaiting = session.researchState?.stage === "awaiting_direction";
  const selected = research.campaign?.selectedProductId;
  const run = research.runs?.at(-1);
  return <>
    <SectionHeading eyebrow="A CREATIVE STARTING POINT" title={research.brandKit?.name || "Meet your brand"}><Badge>{awaiting ? "Choose a direction" : "Research findings"}</Badge></SectionHeading>
    <div className="notice">{awaiting ? "Your brand kit is saved. Choose what to promote before we research product photos." : research.campaign?.status === "needs_selection" ? "Choose a product to focus this campaign. This is a shortlist, not the complete catalog." : "Review the real product and its photo before preparing your ad."}</div>
    <div className="findings-grid">
      <div className="card"><Badge>{research.brandKit?.overrides.voice ? "User supplied" : "Inferred"}</Badge><h3>Brand voice</h3><p>{research.voice}</p></div>
      <div className="card"><Badge>{research.brandKit?.overrides.audience ? "User supplied" : "Inferred"}</Badge><h3>Suggested audience</h3><p>{research.audience}</p></div>
    </div>
    <form className="card" onSubmit={event => { event.preventDefault(); send(/^https?:\/\//i.test(direction) ? `Research ${direction}` : `Promote ${direction}`); setDirection(""); }}>
      <h2>{awaiting ? "What would you like to promote?" : "Refine the scope or add a product"}</h2>
      <label htmlFor="campaign-direction">Product URL, collection, or campaign direction</label>
      <input id="campaign-direction" required maxLength={1800} value={direction} onChange={event => setDirection(event.target.value)} placeholder="A product URL, or our summer case collection" disabled={busy} />
      <Button disabled={busy} primary>Research this direction →</Button>
      {awaiting && <div className="actions">{research.suggestions?.map(choice => <Button type="button" key={choice.id} disabled={busy} onClick={() => send(`[direction:${choice.id}] Research this direction: ${choice.label}`)}>{choice.label} →</Button>)}</div>}
      {awaiting && <p className="small muted">Suggestions come from store navigation. Choosing one starts scoped research.</p>}
    </form>
    {!!research.products?.length && <><h2>Products <span className="muted">{research.products.length} researched</span></h2><div className="source-grid">{research.products.map(product => <div className="card source-card" key={product.id}>
      <h3>{product.title}</h3><p>{product.description}</p><a href={product.canonicalUrl} target="_blank" rel="noreferrer">View source ↗</a>
      {product.price && <p>{product.price.currency} {product.price.amount} · observed price</p>}
      <div className="images">{research.assets?.filter(asset => product.assetIds.includes(asset.id) && asset.eligibleAsProductReference).map(asset => <img key={asset.id} src={asset.originalUrl} alt={`Source photo of ${product.title}`} loading="lazy" />)}</div>
      {!research.assets?.some(asset => product.assetIds.includes(asset.id) && asset.eligibleAsProductReference) && <p className="notice">No verified gallery yet. Assign a matching photo from Unsorted below.</p>}
      <p className="small muted">{product.variants.length ? `${product.variants.length} evidenced variants` : "Variant not established; do not assume a specific size or model."}</p>
      <Button disabled={busy || selected === product.id} onClick={() => void action({ action: "selectProduct", productId: product.id })}>{selected === product.id ? "Selected product" : "Choose this product"}</Button>
    </div>)}</div></>}
    {selected && <div className="card next-step"><div><h2>Ready to shape your ad</h2><p>Use the selected product and verified photo to prepare a brief. Generation still needs your approval.</p></div><Button primary disabled={busy} onClick={() => { create(); send("Prepare an evergreen brief for my selected product using its verified photo. Use no offer."); }}>Prepare a brief →</Button></div>}
    <details className="card"><summary>Unsorted and excluded images · {research.assets?.filter(asset => !asset.eligibleAsProductReference && asset.role !== "logo").length || 0}</summary>
      <p className="muted">These images are not eligible product references. Inspect before assigning them; a filename is not evidence.</p>
      <div className="asset-grid">{research.assets?.filter(asset => !asset.eligibleAsProductReference && asset.role !== "logo").slice(0, 36).map(asset => <div className="card asset" key={asset.id}><img src={asset.originalUrl} alt="Unsorted store image" loading="lazy"/><Badge>{asset.role}</Badge>{asset.visualAssessment && <p className="small muted">Visual inference · {asset.visualAssessment.reason}</p>}<div className="actions"><Button disabled={busy} onClick={() => void action({ action: "correctAsset", assetId: asset.id, role: "promotion_graphic" })}>This is a banner</Button>{selected && <Button disabled={busy} onClick={() => void action({ action: "correctAsset", assetId: asset.id, role: "product_photo", productId: selected })}>Confirm as selected product</Button>}</div></div>)}</div>
    </details>
    <details className="card"><summary>Offers and customer evidence</summary><p>No offer is selected by default. Full restrictions and customer eligibility must be checked before using a promotion.</p>{research.offers?.map(offer => <p key={offer.id}>{offer.quote} <Badge>{offer.eligibility}</Badge><br/><a href={offer.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a> · checked {new Date(offer.checkedAt).toLocaleDateString()}{selected && offer.eligibility !== "eligible" && <Button disabled={busy} onClick={() => void action({ action: "confirmOffer", offerId: offer.id, productId: selected })}>I confirm this product and target customers meet all these terms</Button>}</p>)}{!research.offers?.length && <p className="muted">No supported offer found. Evergreen product ads can proceed.</p>}{research.customerEvidence?.map(item => <p key={item.id}><Badge>{item.kind}</Badge> {item.value} · {item.productId ? "Product-scoped" : "Company-scoped"} <a href={item.evidence.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a></p>)}{!research.customerEvidence?.length && <p className="muted">No customer evidence found. No rating or testimonial will be invented.</p>}</details>
    <details className="card"><summary>Research coverage and sources</summary><p>{run ? `${run.scope} stage · ${run.status} · ${run.attemptedUrls.length} pages attempted · ${run.failedUrls.length} unavailable` : "Legacy research: refresh a product before making a new brief."}</p>{research.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> · {new Date(source.fetchedAt).toLocaleString()}</p>)}</details>
    {research.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
  </>;
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
    <div className="card"><h2>Semantic palette</h2><div className="palette">{(kit?.colors || research.colors.map(color => ({ ...color, role: "observed" }))).map((color, index) => <div key={index}><span style={{ backgroundColor: color.value }}/>{color.role} · {color.value}</div>)}</div><h3>Typography</h3><p>Heading: {kit?.typography.heading.value || "Not found"} · Body: {kit?.typography.body.value || "Not found"}</p><p className="muted">{kit?.typography.substitution || "Ads use bundled Geist."}</p></div>
    {kit && <form className="card" onSubmit={event => { event.preventDefault(); void action({ action: "correctBrand", field, value }); setValue(""); }}><h2>Correct your brand kit</h2><p>Saved corrections take priority when research is refreshed.</p><label htmlFor="brand-field">Field</label><select id="brand-field" value={field} onChange={event => setField(event.target.value as typeof field)}><option value="voice">Voice</option><option value="audience">Audience</option><option value="valueProposition">Value proposition</option></select><label htmlFor="brand-value">Your correction</label><textarea id="brand-value" required maxLength={2000} value={value} onChange={event => setValue(event.target.value)}/><Button>Save correction</Button></form>}
    <div className="card"><h2>Campaign preferences</h2>{Object.entries(session.preferences).map(([key, value]) => <p key={key}><strong>{key}</strong> · {value}</p>)}{!Object.keys(session.preferences).length && <p className="muted">Tell your creative partner your campaign preferences in chat.</p>}</div>
  </>;
}
export function AssetsView({ session }: { session: Session | null }) {
  const assets = session?.research?.assets || [];
  return <><SectionHeading eyebrow="YOUR CREATIVE MATERIALS" title="Assets"><Badge>Current campaign</Badge></SectionHeading><p className="muted">Only classified product photos can be selected for a new ad. Approved source bytes are pinned when preparing a brief.</p><div className="asset-grid">{assets.map(asset => <a className="card asset" key={asset.id} href={asset.originalUrl} target="_blank" rel="noreferrer"><img src={asset.originalUrl} alt={asset.role.replaceAll("_", " ")} loading="lazy"/><Badge>{asset.role.replaceAll("_", " ")}</Badge><p className="small muted">{asset.eligibleAsProductReference ? "Eligible product reference" : "Not a product reference"}</p></a>)}{session?.variants.map(variant => <a className="card asset" key={variant.id} href={variant.imageUrl} target="_blank" rel="noreferrer"><img src={variant.imageUrl} alt={variant.brief.headline} loading="lazy"/><h3>{variant.brief.headline}</h3><Badge>Saved output</Badge></a>)}</div>{!assets.length && !session?.variants.length && <EmptyState title="A home for your product photos">Research a product to collect its gallery.</EmptyState>}</>;
}
