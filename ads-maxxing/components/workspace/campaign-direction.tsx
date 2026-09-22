"use client";
import { useId, useState } from "react";
import type { Research } from "@/lib/workflow/session-types";
import type { GenerationSource } from "@/lib/workflow/generation-contracts";
import { Button } from "./ui";

export function CampaignDirection({
  research,
  busy,
  generate,
}: {
  research: Research;
  busy: boolean;
  generate: (source: GenerationSource) => void;
}) {
  const fieldId = useId();
  const suggestions = research.suggestions || [];
  const [choiceId, setChoiceId] = useState(suggestions[0]?.id || "");
  const [direction, setDirection] = useState("");
  return (
    <section className="campaign-direction" aria-labelledby={`${fieldId}-heading`}>
      <span className="eyebrow">YOUR NEXT CAMPAIGN</span>
      <h2 id={`${fieldId}-heading`}>What would you like to promote?</h2>
      <p className="muted">Pick a starting point or share your idea. We’ll find the product photos, write the copy, and create your first ad.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!busy && (choiceId || direction.trim()))
          generate(choiceId ? { choiceId } : { direction: direction.trim() });
      }}>
        {!!suggestions.length && (
          <fieldset className="campaign-suggestions" disabled={busy}>
            <legend className="sr-only">Suggested campaign directions</legend>
            {suggestions.map((choice) => (
              <label className={`campaign-choice ${choiceId === choice.id ? "is-selected" : ""}`} key={choice.id}>
                <input type="radio" name={`${fieldId}-choice`} value={choice.id} checked={choiceId === choice.id} onChange={() => { setChoiceId(choice.id); setDirection(""); }} />
                <span><strong>{choice.label}</strong>{choice.reason && <small>{choice.reason}</small>}</span>
              </label>
            ))}
          </fieldset>
        )}
        <label htmlFor={`${fieldId}-direction`}>{suggestions.length ? "Or start with your own idea" : "Your campaign idea or product URL"}</label>
        <textarea
          id={`${fieldId}-direction`}
          value={direction}
          maxLength={2000}
          rows={3}
          disabled={busy}
          placeholder="Launch our new collection… or paste a product URL"
          onChange={(event) => { setDirection(event.target.value); setChoiceId(""); }}
        />
        <div className="campaign-launch">
          <p className="small muted">One portrait ad, using your real product. You can refine it before accepting.</p>
          <Button primary disabled={busy || (!choiceId && !direction.trim())}>{busy ? "Getting started…" : "Generate ad →"}</Button>
        </div>
      </form>
    </section>
  );
}
