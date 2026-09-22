import { useState } from "react";
import type { Session } from "@/lib/workflow/session-types";
import { Button } from "./ui";

export function CampaignProgress({ session, busy, error, recover, inspect, refresh, retryStart }: {
  session: Session;
  busy: boolean;
  error: string;
  recover: (acknowledgePossibleDuplicate: boolean) => void;
  inspect: () => void;
  refresh: () => void;
  retryStart?: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const next = session.nextAction;
  const needsInput = next?.kind === "needs_input";
  const paused = !busy && (!!error || next?.kind === "retry" || needsInput);
  const latest = session.events.at(-1);
  const phase = !session.brief
    ? session.researchState?.stage === "ready_for_brief" ? "Writing your ad" : "Finding products and photos"
    : !session.variants.some((variant) => variant.brief.id === session.brief?.id)
      ? "Creating your image"
      : "Checking and saving your ad";
  return (
    <section className={`campaign-progress card ${paused ? "is-paused" : ""}`} aria-live="polite">
      <div className="campaign-progress-heading">
        {!paused && <span className="pulse" aria-hidden="true" />}
        <div>
          <span className="eyebrow">{paused ? "YOUR PROGRESS IS SAVED" : "YOUR CREATIVE IS ON ITS WAY"}</span>
          <h2>{needsInput ? "One detail to resolve" : paused ? "Let’s pick up from here" : phase}</h2>
        </div>
      </div>
      <p>{error || next?.message || "We’re using your brand research and real product photos. You can review the finished ad here."}</p>
      {!paused && <p className="small muted">Progress saves as we go. If you leave, open this campaign to continue.</p>}
      {next?.duplicateRisk && !busy && (
        <label className="retry-acknowledgement">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>The earlier image request may have completed. I want to start a new paid attempt.</span>
        </label>
      )}
      {!busy && (
        <div className="actions">
          {needsInput ? (
            <Button primary onClick={inspect}>Review product details →</Button>
          ) : next?.kind === "retry" || next?.kind === "continue" ? (
            <Button primary disabled={!!next.duplicateRisk && !acknowledged} onClick={() => recover(acknowledged)}>
              {next?.kind === "retry" ? next.briefId ? "Retry image generation" : "Retry this step" : "Continue saved work"}
            </Button>
          ) : error ? <Button primary onClick={retryStart || refresh}>{retryStart ? "Try again" : "Refresh saved progress"}</Button> : null}
        </div>
      )}
      {!!session.events.length && (
        <details className="campaign-activity">
          <summary>Activity{latest ? ` · ${session.events.length} updates` : ""}</summary>
          <ol>
            {session.events.slice(-16).map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span>{event.status === "failed" ? "Paused" : event.status === "completed" ? "Done" : "Started"}</span>{" · "}
                {event.detail || event.action.replaceAll("_", " ")}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
