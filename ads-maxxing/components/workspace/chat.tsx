import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import type { Session } from "@/lib/workflow/session-types";
import { Badge, Button } from "./ui";
export type ChatAttachment =
  | { kind: "variant"; id: string; headline: string }
  | { kind: "product"; productId: string; variantId: string | null; label: string };
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
  attachment: ChatAttachment | null;
  detach: () => void;
  openBrief: () => void;
  refresh: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === "assistant") return;
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
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <span className="message-author">
              {m.role === "user" ? "YOU" : "CREATIVE PARTNER"}
            </span>
            {m.parts.map((p, i) => {
              if (p.type === "text")
                return (
                  <div key={i} className="message-text">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ children, href, title }) => (
                          <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                        table: ({ children }) => (
                          <div className="message-table">
                            <table>{children}</table>
                          </div>
                        ),
                      }}
                    >
                      {p.text}
                    </Markdown>
                  </div>
                );
              if (!p.type.startsWith("tool-")) return null;
              const state = "state" in p ? String(p.state) : "";
              const output = "output" in p ? p.output : null;
              const failed =
                state === "output-error" ||
                !!(output && typeof output === "object" && "error" in output);
              const complete = state === "output-available";
              const detail = output && typeof output === "object" && "error" in output && typeof output.error === "string"
                ? output.error
                : "errorText" in p && typeof p.errorText === "string" ? p.errorText : null;
              const running = busy && m.id === messages.at(-1)?.id;
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
                        ? detail || "Couldn’t complete this step. Try again when you’re ready."
                        : complete
                          ? "Saved to your workspace"
                          : running ? "In progress" : "Interrupted. Refresh saved state before trying again."}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {!!session?.events.some(event => event.action.startsWith("research:")) && (
          <details className="activity-card research-activity">
            <summary>Research activity</summary>
            <ol className="small" aria-live="polite">
              {session.events.filter(event => event.action.startsWith("research:")).slice(-18).map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <time>{new Date(event.at).toLocaleTimeString()}</time>{" · "}
                  {event.status === "failed" ? "Failed" : event.status === "completed" ? "Done" : "Started"}{" · "}
                  {event.detail}
                </li>
              ))}
            </ol>
          </details>
        )}
        {session?.brief && (
          <div className="chat-brief">
            <Badge tone="warning">
              {session.researchState?.generationIntent
                ? "Campaign creative"
                : session.brief.generationAttemptedAt
                ? "Generation attempted"
                : session.brief.approvedAt
                  ? "Approved brief"
                  : "Your review needed"}
            </Badge>
            <h3>{session.brief.headline}</h3>
            <p className="muted small">
              You can adjust the product photo, headline, and creative direction.
            </p>
            <Button disabled={busy} onClick={openBrief}>Edit creative details →</Button>
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
              {attachment.kind === "variant"
                ? `Feedback on: ${attachment.headline}`
                : `Planning for: ${attachment.label}`}
              <small>
                {attachment.kind === "variant"
                  ? attachment.id.slice(0, 8)
                  : "Campaign product"}
              </small>
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
          placeholder={attachment?.kind === "product"
            ? "What angle should this product ad take?"
            : "Share a thought or a new direction…"}
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
