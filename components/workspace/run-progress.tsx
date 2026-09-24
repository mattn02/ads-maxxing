"use client";

import { Children, useEffect, useState, type ReactNode } from "react";
import type { ProgressState, ProgressStep } from "@/lib/workspace/progress";
import { BrandMark } from "./brand-mark";
import "./progress.css";

export type RunStep = ProgressStep;
export type RunState = ProgressState;

export function RunProgress({ mode, state, stage, steps, startedAt, latestEvent, productImage, title, description, children }: {
  mode: "setup" | "campaign";
  state: RunState;
  stage: string;
  steps: RunStep[];
  startedAt?: string;
  latestEvent?: string;
  productImage?: { src: string; alt: string };
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setNow(Date.now());
    tick();
    if (state !== "active") return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, state]);

  const start = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed = now !== null && Number.isFinite(start) && now >= start
    ? Math.floor((now - start) / 1000)
    : null;
  const statusLabel = {
    active: "Working",
    paused: "Ready to continue",
    needs_input: "Your input needed",
    retry: "Retry available",
    failed: "Paused after an error",
    complete: "Complete",
  }[state];
  const heading = title || (state === "active" || state === "needs_input" ? stage
    : state === "failed" ? "This step needs another try"
      : state === "complete" ? mode === "setup" ? "Your brand kit is ready" : "Your ad is ready"
        : "Ready to pick up from here");
  const controls = Children.toArray(children).length > 0
    ? <div className="run-progress__controls">{children}</div>
    : null;

  return (
    <section className={`run-progress run-progress--${state} run-progress--${mode}`} aria-label={`${mode === "setup" ? "Brand research" : "Ad creation"} progress`}>
      <div className="run-progress__hero">
        <div className="run-progress__art" aria-hidden="true">
          <BrandMark size={112} animated={state === "active"} className="run-progress__mark" />
        </div>
        <div className="run-progress__summary" aria-live="polite" aria-atomic="true">
          <div className="run-progress__meta">
            <span className="run-progress__state">{statusLabel}</span>
          </div>
          <h2>{heading}</h2>
          {description && <p>{description}</p>}
          {latestEvent && <p className="run-progress__event"><span aria-hidden="true" />{latestEvent}</p>}
        </div>
      </div>
      {state === "active" && elapsed !== null && <p className="run-progress__elapsed" aria-hidden="true">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed</p>}
      {state !== "active" && controls}
      <ol className="run-progress__steps" aria-label="Run steps">
        {steps.map((step, index) => (
          <li key={step.id} className={`run-progress__step run-progress__step--${step.status}`} aria-current={step.status === "current" ? "step" : undefined}>
            <span className="run-progress__step-symbol" aria-hidden="true">{step.status === "complete" ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      {productImage && <div className="run-progress__source">
        {/* The selected storefront URL may be on any Shopify image host. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={productImage.src} alt={productImage.alt} />
        <div><span>Selected source photo</span><p>This verified store photo anchors the current ad.</p></div>
      </div>}
      {state === "active" && controls}
    </section>
  );
}
