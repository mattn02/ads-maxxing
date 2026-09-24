"use client";

import { useState } from "react";
import type { Session } from "@/lib/workflow/session-types";
import { campaignProgress } from "@/lib/workspace/progress";
import { Button } from "./ui";
import { RunProgress } from "./run-progress";

const eventLabels: Record<string, string> = {
  research: "Store research",
  brief: "Creative plan",
  generate: "Image creation",
  review: "Ad review",
  approve_brief: "Creative approval",
};

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
  const intent = session.researchState?.generationIntent;
  const next = session.nextAction;
  const needsInput = next?.kind === "needs_input";
  const { state, stage, steps, currentEvents, productImage } = campaignProgress(session, busy, error);
  const latest = currentEvents.at(-1);
  const latestEvent = latest ? `${eventLabels[latest.action] || latest.action.replaceAll("_", " ")} ${latest.status === "started" ? "started" : latest.status === "failed" ? "paused" : "saved"}${latest.detail ? ` · ${latest.detail}` : ""}` : undefined;
  const showActions = !busy && (needsInput || next?.kind === "retry" || next?.kind === "continue" || !!error);

  return (
    <div className="campaign-progress">
      <RunProgress
        mode="campaign"
        state={state}
        stage={stage}
        steps={steps}
        startedAt={intent?.authorizedAt}
        latestEvent={latestEvent}
        productImage={productImage}
        description={error || next?.message || (state === "active" ? "Your work saves as each step finishes. You can return to this campaign while we work." : undefined)}
      >
        {next?.duplicateRisk && !busy && (
          <label className="retry-acknowledgement">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>The earlier image request may have completed. I want to start a new paid attempt.</span>
          </label>
        )}
        {showActions && <div className="actions">
          {needsInput ? <Button primary onClick={inspect}>Review product &amp; offer →</Button>
            : next?.kind === "retry" || next?.kind === "continue" ? (
              <Button primary disabled={!!next.duplicateRisk && !acknowledged} onClick={() => recover(acknowledged)}>
                {next.kind === "retry" ? next.briefId ? "Retry image generation" : "Retry this step" : "Continue saved work"}
              </Button>
            ) : error ? <Button primary onClick={retryStart || refresh}>{retryStart ? "Try again" : "Refresh saved progress"}</Button> : null}
        </div>}
        {!!currentEvents.length && <details className="campaign-activity">
          <summary>Activity · {currentEvents.length} updates</summary>
          <ol>{currentEvents.slice(-16).map((event, index) => <li key={`${event.at}-${index}`}>
            <span>{event.status === "failed" ? "Paused" : event.status === "completed" ? "Done" : "Started"}</span>{" · "}
            {event.detail || eventLabels[event.action] || event.action.replaceAll("_", " ")}
          </li>)}</ol>
        </details>}
      </RunProgress>
    </div>
  );
}
