import { useEffect, useRef } from "react";
import Image from "next/image";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import type { Session, Variant } from "@/lib/workflow/session-types";
import { groupVariants } from "@/lib/workspace/api";
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
  openBrief,
  refresh,
  variant,
}: {
  session: Session | null;
  messages: ConciergeMessage[];
  input: string;
  setInput: (s: string) => void;
  send: (s: string) => void;
  busy: boolean;
  error?: string;
  openBrief: () => void;
  refresh: () => void;
  variant?: Variant;
}) {
  const end = useRef<HTMLDivElement>(null);
  const history = variant ? groupVariants(session?.variants ?? []).find(group => group.some(item => item.id === variant.id)) : undefined;
  const version = history?.findIndex(item => item.id === variant?.id) ?? -1;
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === "assistant") return;
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);
  return (
    <>
      <div className="chat-heading">
        {variant ? <Image src={variant.imageUrl} alt="" width={32} height={32} unoptimized className="chat-target-image" /> : <div className="partner-icon">✧</div>}
        <div>
          <strong>{variant ? "Refine this ad" : "Creative partner"}</strong>
          <p className="muted small">{variant ? `${variant.research.products?.find(product => product.id === variant.brief.productId)?.title ?? variant.brief.productUrl} · Version ${version + 1} of ${history?.length ?? 1}` : "A little direction. A lot of ideas."}</p>
        </div>
      </div>
      <div className="chat-messages" aria-label="Conversation">
        {variant && messages.length === 0 && (
          <div className="chat-empty">
            <strong>What would you change?</strong>
            <p className="small muted">Ask for a shorter headline, a different setting, or another detail of this ad. You’ll review the new brief before generating a version.</p>
          </div>
        )}
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
              const detailInReply = detail && m.parts.some(part => part.type === "text" && part.text.includes(detail));
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
                        ? detailInReply ? "This step wasn’t completed." : detail || "Couldn’t complete this step. Try again when you’re ready."
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
        {session?.brief && (!variant || (session.brief.parentVariantId === variant.id && !session.variants.some(saved => saved.brief.id === session.brief?.id))) && (
          <div className="chat-brief">
            <Badge tone="warning">
              {variant ? "Your review needed" : session.researchState?.generationIntent
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
            <Button disabled={busy} onClick={openBrief}>{variant ? "Review proposed changes →" : "Edit creative details →"}</Button>
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
        <label className="sr-only" htmlFor="chat-message">
          Message your creative partner
        </label>
        <textarea
          id="chat-message"
          rows={3}
          value={input}
          maxLength={8000}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What would you change about this ad?"
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
      <p className="chat-footnote">New versions need your approval before generation.</p>
    </>
  );
}
