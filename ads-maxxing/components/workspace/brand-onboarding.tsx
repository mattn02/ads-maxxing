"use client";
import { useState } from "react";
import type { Session } from "@/lib/workflow/session-types";
import { normalizeStoreInput } from "@/lib/workflow/onboarding-contracts";
import { Button } from "./ui";

export function BrandOnboarding({
  session,
  busy,
  submit,
  retry,
  edit,
}: {
  session: Session | null;
  busy: boolean;
  submit: (url: string) => void;
  retry: () => void;
  edit: () => void;
}) {
  const [url, setUrl] = useState(session?.setup?.originalUrl || "");
  const setup = session?.setup;
  const active = !!session?.operationActive;
  let normalized = "";
  try {
    normalized = normalizeStoreInput(url).storeUrl;
  } catch {
    /* Inline hint below. */
  }
  if (setup && (setup.state !== "needs_url" || active)) {
    const interrupted = setup.state === "researching" && !active && !busy;
    return (
      <section className="brand-onboarding">
        <span className="eyebrow">YOUR BRAND, FIRST</span>
        <h1>
          {setup.state === "failed" || interrupted
            ? "Let’s pick up from here."
            : "Getting to know your brand."}
        </h1>
        <p className="muted">{setup.storeUrl}</p>
        {active || busy ? (
          <div className="setup-progress" role="status" aria-live="polite">
            <span className="pulse" />
            {setup.progress === "understanding"
              ? "Understanding your brand"
              : setup.progress === "saving"
                ? "Saving your brand kit"
                : "Reading your store"}
            <p className="small muted">
              We’re collecting your identity, voice, and a few creative starting
              points.
            </p>
          </div>
        ) : (
          <>
            <p className="notice">
              {setup.error ||
                "Research was interrupted. Any findings collected so far are saved. Retry when you’re ready."}
            </p>
            {session?.research?.sources.length ? (
              <p className="small muted">
                Saved observations from {session.research.sources.length} store
                pages.
              </p>
            ) : null}
            <div className="actions">
              <Button primary onClick={retry} disabled={busy}>
                Retry research
              </Button>
              <Button onClick={edit} disabled={busy}>
                Edit URL
              </Button>
            </div>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="brand-onboarding">
      <span className="eyebrow">FROM YOUR STORE TO YOUR NEXT AD</span>
      <h1>Get to know your brand.</h1>
      <p className="setup-description">
        Share your Shopify store URL. We’ll learn its look, voice, and what makes
        it different, then help you find a creative direction.
      </p>
      <p className="small muted">This version supports Shopify storefronts. Just the URL—no app installation required.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (normalized) submit(url);
        }}
      >
        <label htmlFor="store-url">Shopify store URL</label>
        <div className="setup-url-row">
          <input
            id="store-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="www.loopycases.com"
            required
            maxLength={4000}
            disabled={busy}
            autoComplete="url"
          />
          <Button primary disabled={busy || !normalized}>
            {busy ? "Opening your brand…" : "Research brand →"}
          </Button>
        </div>
        <p className="small muted">
          {normalized
            ? `We’ll research ${normalized}`
            : "Enter your Shopify store’s domain. Example: www.loopycases.com"}
        </p>
        {normalized &&
          new URL(normalizeStoreInput(url).originalUrl).pathname !== "/" && (
            <p className="small muted">
              We’ll keep the page you shared as an option for your first
              campaign.
            </p>
          )}
      </form>
      <div className="setup-expectations">
        <div>
          <strong>01 · Learn your brand</strong>
          <p>Identity, voice, and positioning.</p>
        </div>
        <div>
          <strong>02 · Choose a direction</strong>
          <p>Pick a suggestion or share your own idea.</p>
        </div>
        <div>
          <strong>03 · Make it yours</strong>
          <p>We create your ad. You refine and accept it.</p>
        </div>
      </div>
    </section>
  );
}
