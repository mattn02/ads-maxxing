/* eslint-disable @next/next/no-img-element -- Store source photos have arbitrary remote hosts. */
import { useState } from "react";
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
            `Research ${url}. Start with brand and product findings only. Identify sourced facts and inferred voice and audience. Ask me what to promote before preparing any brief. Do not generate an ad.`,
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
export function ResearchView({
  session,
  busy,
  send,
  create,
}: {
  session: Session;
  busy: boolean;
  send: (text: string) => void;
  create: () => void;
}) {
  const [productUrl, setProductUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const research = session.research!;
  return (
    <>
      <SectionHeading
        eyebrow="A CREATIVE STARTING POINT"
        title="Meet your brand"
      >
        <Badge>Research findings</Badge>
      </SectionHeading>
      <div className="notice">
        Review what we found, then choose what you want to advertise.
      </div>
      <div className="findings-grid">
        <div className="card">
          <Badge>Inferred</Badge>
          <h3>Brand voice</h3>
          <p>{research.voice}</p>
        </div>
        <div className="card">
          <Badge>Inferred</Badge>
          <h3>Your audience</h3>
          <p>{research.audience}</p>
        </div>
      </div>
      <h2>
        From your store{" "}
        <span className="muted">{research.sources.length} sources</span>
      </h2>
      <div className="source-grid">
        {research.sources.map((source) => (
          <div className="card source-card" key={source.url}>
            {source.images[0] ? (
              <img src={source.images[0]} alt={source.title} />
            ) : (
              <div className="photo-placeholder">No photo found</div>
            )}
            <Badge>Sourced</Badge>
            <h3>{source.title}</h3>
            <p>
              {source.description || "No description available from this page."}
            </p>
            <a href={source.url} target="_blank" rel="noreferrer">
              View source ↗
            </a>
          </div>
        ))}
      </div>
      {research.warnings.map((w) => (
        <p className="notice" key={w}>
          {w}
        </p>
      ))}
      <div className="card next-step">
        <div>
          <h2>What shall we make?</h2>
          <p className="muted">
            Pick a product and set the direction. We’ll help with the brief.
          </p>
        </div>
        <div className="actions">
          <Button onClick={() => setAdding(!adding)}>+ Add a product</Button>
          <Button primary onClick={create}>
            Create a campaign →
          </Button>
        </div>
      </div>
      {adding && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            send(
              `Research this product: ${productUrl}. Keep the existing brand context. Present findings and ask for campaign direction before preparing a brief.`,
            );
            setAdding(false);
          }}
        >
          <label htmlFor="product-url">Product URL</label>
          <input
            id="product-url"
            type="url"
            required
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
          />
          <Button disabled={busy}>Research product</Button>
        </form>
      )}
      <p className="muted small">Suggested direction · inferred idea</p>
      <Button onClick={create}>✧ Create an evergreen product campaign</Button>
    </>
  );
}
export function BrandView({ session }: { session: Session | null }) {
  if (!session?.research)
    return (
      <EmptyState title="Your brand, all in one place">
        Research a store to collect its imagery, palette, voice, and audience.
      </EmptyState>
    );
  const { research } = session;
  return (
    <>
      <SectionHeading eyebrow="THE FOUNDATION" title="Brand kit" />
      <div className="card">
        <Badge>Sourced</Badge>
        <h2>Store</h2>
        {research.sources.map((s) => (
          <p key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title} ↗
            </a>
          </p>
        ))}
      </div>
      <div className="findings-grid">
        {[
          ["Voice", research.voice],
          ["Audience", research.audience],
        ].map(([label, value]) => (
          <div className="card" key={label}>
            <Badge>Inferred</Badge>
            <h2>{label}</h2>
            <p>{value}</p>
          </div>
        ))}
      </div>
      <div className="card">
        <Badge>Sourced</Badge>
        <h2>Color palette</h2>
        <div className="palette">
          {research.colors.map((c, i) => (
            <a
              key={`${c.value}-${i}`}
              href={c.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span
                style={{
                  backgroundColor: /^#[\da-f]{3,8}$/i.test(c.value)
                    ? c.value
                    : "transparent",
                }}
              />
              {c.value}
            </a>
          ))}
        </div>
        {!research.colors.length && (
          <p className="muted">No colors found in the source.</p>
        )}
      </div>
      <div className="card">
        <h2>Logo & value proposition</h2>
        <p className="muted">
          Not available as structured fields in the current research connection.
        </p>
        <Button disabled>Save brand changes</Button>
      </div>
      <div className="card">
        <Badge>User supplied</Badge>
        <h2>Creative preferences</h2>
        {Object.entries(session.preferences).map(([k, v]) => (
          <p key={k}>
            <strong>{k}</strong> · {v}
          </p>
        ))}
        {!Object.keys(session.preferences).length && (
          <p className="muted">
            Tell your creative partner a preference in chat to remember it for
            this campaign.
          </p>
        )}
      </div>
    </>
  );
}
export function AssetsView({ session }: { session: Session | null }) {
  const sources = session?.research?.sources || [];
  return (
    <>
      <SectionHeading eyebrow="YOUR CREATIVE MATERIALS" title="Assets">
        <Badge>Current campaign</Badge>
      </SectionHeading>
      <p className="muted">
        Original product photography and saved ads for this workspace.
      </p>
      {!sources.some((s) => s.images.length) && !session?.variants.length ? (
        <EmptyState title="A home for your product photos">
          Research a product to bring its source images into your workspace.
        </EmptyState>
      ) : (
        <div className="asset-grid">
          {sources.flatMap((s) =>
            s.images.map((url) => (
              <a
                className="card asset"
                key={`${s.url}-${url}`}
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                <img src={url} alt={s.title} loading="lazy" />
                <h3>{s.title}</h3>
                <Badge>Remote reference</Badge>
                <p className="small muted">Source: {new URL(s.url).hostname}</p>
              </a>
            )),
          )}
          {session?.variants.map((v) => (
            <a
              className="card asset"
              key={v.id}
              href={v.imageUrl}
              target="_blank"
              rel="noreferrer"
            >
              <img src={v.imageUrl} alt={v.brief.headline} loading="lazy" />
              <h3>{v.brief.headline}</h3>
              <Badge>Saved output</Badge>
              <p className="small muted">
                {new Date(v.createdAt).toLocaleDateString()}
              </p>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
