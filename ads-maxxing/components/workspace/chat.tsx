import { useEffect, useRef } from "react";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import type { Session } from "@/lib/workflow/session-types";
import { Badge, Button } from "./ui";
const toolLabels: Record<string, string> = {
  research: "Researching your brand",
  prepareBrief: "Preparing the creative brief",
  generateAd: "Generating your ad",
  reviewAd: "Checking your ad",
  rememberPreference: "Saving your preference",
};
export function ChatPanel({
  session,
  messages,
  input,
  setInput,
  send,
  busy,
  error,
  attachment,
  detach,
  openBrief,
  refresh,
}: {
  session: Session | null;
  messages: ConciergeMessage[];
  input: string;
  setInput: (s: string) => void;
  send: (s: string) => void;
  busy: boolean;
  error?: string;
  attachment: { id: string; headline: string } | null;
  detach: () => void;
  openBrief: () => void;
  refresh: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);
  return (
    <>
      <div className="chat-heading">
        <div className="partner-icon">✧</div>
        <div>
          <strong>Creative partner</strong>
          <p className="muted small">A little direction. A lot of ideas.</p>
        </div>
      </div>
      <div className="chat-messages" aria-label="Conversation">
        <div className="message assistant">
          <span className="message-author">CREATIVE PARTNER</span>
          <p>Let’s make something worth stopping for.</p>
          <p className="muted">
            Share your store URL. I’ll research your brand and products, then
            we’ll choose a direction together.
          </p>
        </div>
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <span className="message-author">
              {m.role === "user" ? "YOU" : "CREATIVE PARTNER"}
            </span>
            {m.parts.map((p, i) => {
              if (p.type === "text")
                return (
                  <p key={i} className="message-text">
                    {p.text}
                  </p>
                );
              if (!p.type.startsWith("tool-")) return null;
              const state = "state" in p ? String(p.state) : "";
              const output = "output" in p ? p.output : null;
              const failed =
                state === "output-error" ||
                !!(output && typeof output === "object" && "error" in output);
              const complete = state === "output-available";
              return (
                <div className="activity-card" key={i}>
                  <span aria-hidden="true">
                    {failed ? "!" : complete ? "✓" : "◌"}
                  </span>
                  <div>
                    <strong>
                      {toolLabels[p.type.slice(5)] || "Updating workspace"}
                    </strong>
                    <p className="small muted">
                      {failed
                        ? "Couldn’t complete this step. See the response for details."
                        : complete
                          ? "Saved to your workspace"
                          : "In progress"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {session?.brief && (
          <div className="chat-brief">
            <Badge tone="warning">
              {session.brief.generationAttemptedAt
                ? "Generation attempted"
                : session.brief.approvedAt
                  ? "Approved brief"
                  : "Your review needed"}
            </Badge>
            <h3>{session.brief.headline}</h3>
            <p className="muted small">
              Review the exact product photo, headline, and creative direction.
            </p>
            <Button onClick={openBrief}>Open current brief →</Button>
          </div>
        )}
        {busy && (
          <p className="working" role="status">
            <span className="pulse" /> Working on your creative…
          </p>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
            <Button disabled={busy} onClick={refresh}>
              Refresh saved state
            </Button>
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) send(input);
        }}
      >
        {attachment && (
          <div className="attachment">
            <span>
              Feedback on: {attachment.headline}
              <small>{attachment.id.slice(0, 8)}</small>
            </span>
            <button
              type="button"
              aria-label="Remove feedback attachment"
              onClick={detach}
            >
              ×
            </button>
          </div>
        )}
        <label className="sr-only" htmlFor="chat-message">
          Message your creative partner
        </label>
        <textarea
          id="chat-message"
          rows={3}
          value={input}
          maxLength={8000}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Share a thought or a new direction…"
        />
        <div className="composer-footer">
          <span className="muted small">
            {busy ? "Working…" : "You steer. We create."}
          </span>
          <Button
            primary
            disabled={busy || !input.trim()}
            aria-label="Send message"
          >
            ↑
          </Button>
        </div>
      </form>
      <p className="chat-footnote">Generated ads always need your approval.</p>
    </>
  );
}
