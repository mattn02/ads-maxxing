"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import type { Session, Variant } from "@/lib/workflow/session-types";
import {
  workspaceApi,
  storeName,
  type CampaignSummary,
  type WorkflowAction,
} from "@/lib/workspace/api";
import { Button } from "@/components/workspace/ui";
import {
  AssetsView,
  BrandView,
  Onboarding,
  ResearchView,
} from "@/components/workspace/research";
import { AdsView, BriefEditor, CampaignForm } from "@/components/workspace/ads";
import { ChatPanel } from "@/components/workspace/chat";
type Section = "Ads" | "Assets" | "Brand";
export function WorkflowConsole({
  initialSessions,
  initialSession = null,
}: {
  initialSessions: CampaignSummary[];
  initialSession?: Session | null;
}) {
  const [session, setSession] = useState(initialSession);
  const [sessions, setSessions] = useState(initialSessions);
  const [opening, setOpening] = useState(!initialSession);
  const [error, setError] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const boot = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (initialSession || boot.current) return;
    boot.current = (async () => {
      try {
        const saved = await workspaceApi.list();
        setSessions(saved);
        if (saved[0]) setSession(await workspaceApi.open(saved[0].id));
      } catch (e) { setError((e as Error).message); }
      finally { setOpening(false); }
    })();
  }, [initialSession]);
  async function open(id?: string, text = "") {
    setOpening(true);
    setError("");
    try {
      const next = id
        ? await workspaceApi.open(id)
        : await workspaceApi.create();
      setFirstMessage(text);
      setSession(next);
      setSessions(await workspaceApi.list());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }
  return (
    <Workbench
      key={session?.id || "setup"}
      initial={session}
      sessions={sessions}
      open={open}
      opening={opening}
      loadError={error}
      firstMessage={firstMessage}
    />
  );
}
function Workbench({
  initial,
  sessions,
  open,
  opening,
  loadError,
  firstMessage,
}: {
  initial: Session | null;
  sessions: CampaignSummary[];
  open: (id?: string, text?: string) => Promise<void>;
  opening: boolean;
  loadError: string;
  firstMessage: string;
}) {
  const [session, setSession] = useState(initial);
  const [section, setSection] = useState<Section>("Ads");
  const [view, setView] = useState<
    "overview" | "brief" | "campaign" | "research"
  >("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<{
    id: string;
    headline: string;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [mobileChat, setMobileChat] = useState(false);
  const [chatWidth, setChatWidth] = useState(380);
  const sent = useRef(false);
  async function refresh() {
    if (!initial) return;
    try {
      setSession(await workspaceApi.open(initial.id));
    } catch (e) {
      setActionError((e as Error).message);
    }
  }
  const { messages, sendMessage, status, error } = useChat<ConciergeMessage>({
    id: initial?.id || "setup",
    messages: (initial?.messages as ConciergeMessage[]) || [],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: { id, message: messages[messages.length - 1] },
      }),
    }),
    onFinish: () => {
      void refresh();
    },
    onError: () => {
      void refresh();
    },
  });
  useEffect(() => {
    if (initial && firstMessage && !sent.current) {
      sent.current = true;
      void sendMessage({ text: firstMessage });
    }
  }, [initial, firstMessage, sendMessage]);
  const busy =
    opening || actionBusy || status === "submitted" || status === "streaming";
  async function action(body: WorkflowAction) {
    if (!session) return false;
    setActionBusy(true);
    setActionError("");
    try {
      setSession(await workspaceApi.action(session.id, body));
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      await refresh();
      return false;
    } finally {
      setActionBusy(false);
    }
  }
  function send(text: string) {
    if (busy) return;
    if (!session) {
      void open(undefined, text);
      return;
    }
    const prompt = attachment
      ? `Feedback on variant ${attachment.id} (${attachment.headline}): ${text}. Prepare a new brief linked to this parent variant; preserve the original ad.`
      : text;
    setInput("");
    setAttachment(null);
    setActionError("");
    void sendMessage({ text: prompt });
  }
  function feedback(variant: Variant) {
    setAttachment({ id: variant.id, headline: variant.brief.headline });
    setChatOpen(true);
    setMobileChat(true);
  }
  function openBrief() {
    setSection("Ads");
    setView("brief");
    setMobileChat(false);
  }
  const name = storeName(session);
  const showBrief =
    session?.brief &&
    (view === "brief" || (view === "overview" && !session.variants.length));
  return (
    <div
      className={`workspace ${chatOpen ? "" : "chat-closed"} ${mobileChat ? "show-chat" : ""}`}
      style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <Link className="wordmark" href="/" aria-label="Studio home">
          <span>◈</span> studio<span className="wordmark-dot">.</span>
        </Link>
        <div className="brand-identity">
          <span className="brand-avatar">
            {name === "Your brand" ? "◇" : name[0].toUpperCase()}
          </span>
          <div>
            <strong>{name}</strong>
            <span>Creative workspace</span>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Workspace">
          {(["Ads", "Assets", "Brand"] as Section[]).map((s, i) => (
            <button
              key={s}
              className={`nav-item ${section === s ? "selected" : ""}`}
              aria-current={section === s ? "page" : undefined}
              onClick={() => {
                setSection(s);
                setView("overview");
                setMobileChat(false);
              }}
            >
              <span aria-hidden="true">{["▦", "▧", "◈"][i]}</span>
              {s}
              {s === "Ads" && !!session?.variants.length && (
                <small>{session.variants.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" /> Private workspace
            <p>Your work saves automatically.</p>
          </div>
          <div className="user-profile">
            <span>D</span>
            <div>
              <strong>Demo workspace</strong>
              <small>Let’s make something good.</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{section}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              className="mobile-switch"
              onClick={() => {
                setMobileChat(!mobileChat);
                setChatOpen(true);
              }}
            >
              {mobileChat ? "Workspace" : "Chat"}
            </Button>
            <Button
              className="desktop-chat-toggle"
              aria-expanded={chatOpen}
              onClick={() => setChatOpen(!chatOpen)}
            >
              {chatOpen ? "Hide chat" : "Show chat"} ☷
            </Button>
          </div>
        </header>
        <div className="campaign-bar">
          <label className="sr-only" htmlFor="campaign-select">
            Saved campaign
          </label>
          <select
            id="campaign-select"
            disabled={busy}
            value={session?.id || ""}
            onChange={(e) => void open(e.target.value)}
          >
            <option value="" disabled>
              Brand setup
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === session?.id
                  ? session.preferences.campaignName || s.title
                  : s.title}
              </option>
            ))}
          </select>
          <Button disabled={busy} onClick={() => void open()}>
            + New workspace
          </Button>
        </div>
        <main className="main-scroll">
          {loadError && (
            <div role="alert" className="error-box">
              {loadError}
            </div>
          )}
          {actionError && (
            <div role="alert" className="error-box">
              {actionError}
            </div>
          )}
          {section === "Assets" ? (
            <AssetsView session={session} />
          ) : section === "Brand" ? (
            <BrandView session={session} action={action} />
          ) : !session?.research ? (
            <Onboarding busy={busy} submit={send} />
          ) : view === "campaign" ? (
            <CampaignForm
              session={session}
              busy={busy}
              send={send}
              cancel={() => setView("overview")}
            />
          ) : showBrief ? (
            <>
              <Button onClick={() => setView("research")}>
                ← Research findings
              </Button>
              <BriefEditor
                key={session.brief!.id}
                session={session}
                busy={busy}
                action={action}
              />
            </>
          ) : view === "research" || !session.variants.length ? (
            <ResearchView
              session={session}
              busy={busy}
              send={send}
              create={() => setView("campaign")}
              action={action}
            />
          ) : (
            <>
              <div className="actions view-links">
                <Button onClick={() => setView("research")}>
                  Research findings
                </Button>
                {session.brief && (
                  <Button onClick={openBrief}>Current brief</Button>
                )}
              </div>
              <AdsView
                session={session}
                selected={selected}
                select={setSelected}
                feedback={feedback}
                create={() => setView("campaign")}
                busy={busy}
                action={action}
              />
            </>
          )}
        </main>
      </div>
      <aside className="chat-panel" aria-label="Creative partner">
        <div
          className="resize-handle"
          role="separator"
          aria-label="Resize chat panel"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={520}
          aria-valuenow={chatWidth}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setChatWidth((w) =>
                Math.max(
                  320,
                  Math.min(520, w + (e.key === "ArrowLeft" ? 20 : -20)),
                ),
              );
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              setChatWidth(
                Math.max(320, Math.min(520, window.innerWidth - e.clientX)),
              );
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        />
        <ChatPanel
          session={session}
          messages={messages}
          input={input}
          setInput={setInput}
          send={send}
          busy={busy}
          error={actionError || error?.message || session?.lastError}
          attachment={attachment}
          detach={() => setAttachment(null)}
          openBrief={openBrief}
          refresh={() => void refresh()}
        />
      </aside>
    </div>
  );
}
