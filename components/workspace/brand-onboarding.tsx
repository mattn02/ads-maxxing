"use client";
import { useState } from "react";
import type { Session } from "@/lib/workflow/session-types";
import { normalizeStoreInput } from "@/lib/workflow/onboarding-contracts";
import { Button } from "./ui";
import { BrandMark } from "./brand-mark";
import { RunProgress } from "./run-progress";
import "./onboarding.css";

export function BrandOnboarding({ session, busy, submit, retry, edit }: {
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
  let isProductPath = false;
  try {
    const input = normalizeStoreInput(url);
    normalized = input.storeUrl;
    isProductPath = new URL(input.originalUrl).pathname !== "/";
  } catch {
    /* Keep the typed URL in place so the user can correct it. */
  }

  if (setup && (setup.state !== "needs_url" || active)) {
    const working = active || busy;
    const current = setup.progress === "saving" ? 2 : setup.progress === "understanding" ? 1 : 0;
    const stepNames = ["Catch the vibe", "Understand the brand", "Save the brand kit"];
    return (
      <section className="brand-onboarding onboarding-status" aria-labelledby="onboarding-status-title">
        <span className="eyebrow">BRAND RESEARCH</span>
        <h1 id="onboarding-status-title">{working ? "Catching your brand’s vibe." : "Let’s pick up from here."}</h1>
        <p className="onboarding-store-url">{setup.storeUrl}</p>
        <RunProgress
          mode="setup"
          state={working ? "active" : setup.state === "failed" ? "failed" : "paused"}
          stage={stepNames[current]}
          steps={stepNames.map((label, index) => ({ id: String(index), label, status: index < current ? "complete" as const : index === current ? "current" as const : "pending" as const }))}
          startedAt={setup.startedAt}
          title={working ? stepNames[current] : "Research paused"}
          description={working ? "mattGPT is gathering your brand identity and creative starting points. Progress saves as it goes." : setup.error || "Research was interrupted. Any findings collected so far are saved."}
          latestEvent={session?.research?.sources.length ? `${session.research.sources.length} store pages observed` : undefined}
        >
          {!working && <div className="actions"><Button primary onClick={retry} disabled={busy}>Retry research</Button><Button onClick={edit} disabled={busy}>Edit URL</Button></div>}
        </RunProgress>
      </section>
    );
  }

  return (
    <section className="brand-onboarding onboarding-landing" aria-labelledby="onboarding-title">
      <div className="onboarding-main">
        <div className="onboarding-copy">
          <span className="eyebrow">A CREATIVE STUDIO FOR YOUR STORE</span>
          <h1 id="onboarding-title">Your brand’s vibe.<br /><span>Your next great ad.</span></h1>
          <p className="setup-description">Give mattGPT your store URL. It will study the brand, find real product photos, and turn your direction into portrait ads you can review and refine.</p>
          <form onSubmit={(event) => { event.preventDefault(); if (normalized) submit(url); }}>
            <label htmlFor="store-url">Your Shopify store or product URL</label>
            <div className="setup-url-row">
              <input id="store-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="www.loopycases.com" required maxLength={4000} disabled={busy} autoComplete="url" aria-describedby="store-url-help" />
              <Button primary disabled={busy || !normalized}>{busy ? "Catching the vibe…" : "Catch the vibe →"}</Button>
            </div>
            <p id="store-url-help" className="onboarding-input-hint">{normalized ? `Ready to research ${normalized}${isProductPath ? " and keep this page as a starting point" : ""}.` : "Shopify storefronts are supported. No app installation needed."}</p>
          </form>
          <div className="onboarding-assurance"><span aria-hidden="true">↗</span><p><strong>You steer the creative.</strong> Choose what to promote and review the real product photo and any offer before an ad is made.</p></div>
        </div>
        <div className="onboarding-visual" aria-label="From your store URL to a reviewed portrait ad">
          <div className="onboarding-visual-top"><span>mattGPT / creative process</span><span>01—03</span></div>
          <div className="onboarding-portrait">
            <BrandMark size={98} />
            <div className="onboarding-portrait-rule" />
            <span>STORE URL</span><span>CATCH THE VIBE</span><strong>9:16 ADS.</strong>
            <small>PROCESS / ILLUSTRATION</small>
          </div>
          <p>Real product in. Your direction on it. A finished ad to make yours.</p>
        </div>
      </div>
      <div className="setup-expectations" aria-label="How it works">
        <div><span>01</span><strong>Catch the vibe</strong><p>mattGPT reads your store’s identity, voice, and product clues.</p></div>
        <div><span>02</span><strong>Choose a direction</strong><p>Pick a starting point or share a product or campaign idea.</p></div>
        <div><span>03</span><strong>Review and refine</strong><p>Confirm a real photo, then edit, regenerate, or approve the ad.</p></div>
      </div>
    </section>
  );
}
