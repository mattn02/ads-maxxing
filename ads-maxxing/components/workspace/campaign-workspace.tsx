"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import type { Session, Variant } from "@/lib/workflow/session-types";
import type { GenerationSource } from "@/lib/workflow/generation-contracts";
import {
  workspaceApi,
  storeName,
  type CampaignSummary,
  type WorkflowAction,
} from "@/lib/workspace/api";
import { Button } from "@/components/workspace/ui";
import { AssetsView, ResearchView } from "@/components/workspace/research";
import { AdsView, BriefEditor } from "@/components/workspace/ads";
import { ChatPanel } from "@/components/workspace/chat";
import { CampaignDirection } from "./campaign-direction";
import { CampaignProgress } from "./campaign-progress";
import { CampaignProducts } from "./campaign-products";
type Section = "Ads" | "Assets" | "Brand";
export function CampaignWorkspace({
  initial,
  sessions,
  open,
  newBrand,
  newCampaign,
  viewBrand,
  brands,
  selectBrand,
  navigationBusy,
  initialGeneration,
}: {
  navigationBusy: boolean;
  initial: Session;
  sessions: CampaignSummary[];
  open: (id: string) => Promise<void>;
  newBrand: () => void;
  newCampaign: () => void;
  viewBrand: () => void;
  brands: import("@/lib/workflow/onboarding-contracts").BrandSummary[];
  selectBrand: (id: string) => void;
  initialGeneration?: { requestId: string; source: GenerationSource };
}) {
  const [session, setSession] = useState(initial);
  const [section, setSection] = useState<Section>("Ads");
  const [view, setView] = useState<"overview" | "brief" | "research">(
    "overview",
  );
  const [selected, setSelected] = useState<string | null>(initial.variants.at(-1)?.id ?? null);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<{
    id: string;
    headline: string;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [chatWidth, setChatWidth] = useState(380);
  const sessionRef = useRef(initial);
  const working = useRef(false);
  const submittedGeneration = useRef<string | null>(null);
  const [pendingGeneration, setPendingGeneration] = useState(initialGeneration);
  const continued = useRef<string | null>(null);
  const seenVariants = useRef(new Set(initial.variants.map((variant) => variant.id)));
  const receive = useCallback((next: Session) => {
    // A poll issued during a mutation can arrive after its completed response.
    if (next.events.length < sessionRef.current.events.length) return;
    const resolvedInput = sessionRef.current.nextAction?.kind === "needs_input" && next.nextAction?.kind === "continue";
    sessionRef.current = next;
    setSession(next);
    if (resolvedInput) setView("overview");
    const newest = next.variants.at(-1);
    if (newest && !seenVariants.current.has(newest.id)) {
      next.variants.forEach((variant) => seenVariants.current.add(variant.id));
      setSelected(newest.id);
      setSection("Ads");
      setView("overview");
      setMobileChat(false);
      setActionError("");
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      const saved = await workspaceApi.open(initial.id);
      receive(saved);
      setRefreshError("");
      return saved;
    } catch (e) {
      setRefreshError((e as Error).message);
      return null;
    }
  }, [initial.id, receive]);
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
  const chatBusy = status === "submitted" || status === "streaming";
  const busy = navigationBusy || actionBusy || chatBusy || !!session.operationActive;
  useEffect(() => {
    if (!actionBusy && !chatBusy && !session.operationActive) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await workspaceApi.open(initial.id);
        if (active) {
          receive(next);
          setRefreshError("");
        }
      } catch (cause) {
        if (active) setRefreshError((cause as Error).message);
      }
      if (active) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [initial.id, actionBusy, chatBusy, session.operationActive, receive]);
  const action = useCallback(async (body: WorkflowAction) => {
    if (working.current || navigationBusy) return false;
    working.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      receive(await workspaceApi.action(initial.id, body));
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      const saved = await refresh();
      // A lost HTTP response is not a new paid retry. The fresh server
      // capability decides whether the saved, authorized request can resume.
      if (saved?.nextAction?.kind === "continue") setActionError("");
      return false;
    } finally {
      working.current = false;
      setActionBusy(false);
    }
  }, [initial.id, navigationBusy, receive, refresh]);
  useEffect(() => {
    if (!initialGeneration || busy || actionError || submittedGeneration.current === initialGeneration.requestId) return;
    // Strict Mode may mount twice. Only the surviving effect dispatches the
    // explicit Generate click carried from the brand screen.
    const timer = setTimeout(() => {
      submittedGeneration.current = initialGeneration.requestId;
      void action({ action: "generateCampaign", ...initialGeneration });
    }, 0);
    return () => clearTimeout(timer);
  }, [initialGeneration, busy, actionError, action]);
  const next = session.nextAction;
  const continuationKey = next?.kind === "continue"
    ? `${next.requestId}:${session.events.length}:${session.brief?.id}:${session.brief?.backgroundCheckpoint?.state}:${session.brief?.sceneCheckpoint?.state}`
    : null;
  useEffect(() => {
    if (!continuationKey || next?.kind !== "continue" || busy || actionError || refreshError) return;
    const requestId = next.requestId;
    const timer = setTimeout(() => {
      if (continued.current === continuationKey) return;
      continued.current = continuationKey;
      void action({ action: "continueCampaign", requestId });
    }, 150);
    return () => clearTimeout(timer);
  }, [continuationKey, next, busy, actionError, refreshError, action]);
  function generate(source: GenerationSource) {
    if (busy) return;
    setView("overview");
    const pending = { requestId: crypto.randomUUID(), source };
    setPendingGeneration(pending);
    void action({ action: "generateCampaign", ...pending });
  }
  function recover(acknowledgePossibleDuplicate: boolean) {
    if (!next || busy) return;
    if (next.kind === "retry" && next.briefId) {
      void action({ action: "retryCreative", requestId: crypto.randomUUID(), previousRequestId: next.requestId, briefId: next.briefId, acknowledgePossibleDuplicate });
    } else if (next.kind === "retry" || next.kind === "continue") {
      void action({ action: "continueCampaign", requestId: next.requestId });
    }
  }
  function send(text: string) {
    if (busy) return;
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
  const showBrief = session.brief && view === "brief";
  const generating = !!session.researchState?.generationIntent && next?.kind !== "complete";
  const starting = !!pendingGeneration && !session.researchState?.generationIntent && !session.variants.length;
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
              disabled={busy}
              className={`nav-item ${section === s ? "selected" : ""}`}
              aria-current={section === s ? "page" : undefined}
              onClick={() => {
                if (s === "Brand") {
                  viewBrand();
                  return;
                }
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
          <label className="sr-only" htmlFor="brand-select">
            Brand
          </label>
          <select
            id="brand-select"
            disabled={busy}
            value={session.brandId || ""}
            onChange={(event) => selectBrand(event.target.value)}
          >
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
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
          <Button disabled={busy} onClick={newCampaign}>
            + New campaign
          </Button>
          <Button disabled={busy} onClick={newBrand}>
            + New brand
          </Button>
        </div>
        <main className="main-scroll">
          {(actionError || refreshError) && !generating && !starting && (
            <div role="alert" className="error-box">
              {actionError || refreshError}
              {refreshError && <Button disabled={busy} onClick={() => void refresh()}>Refresh saved progress</Button>}
            </div>
          )}
          {section === "Assets" ? (
            <AssetsView session={session} />
          ) : showBrief ? (
            <>
              <Button onClick={() => setView("overview")}>
                ← Back to your campaign
              </Button>
              <BriefEditor
                key={session.brief!.id}
                session={session}
                busy={busy}
                action={action}
              />
            </>
          ) : view === "research" ? (
            <>
              <Button onClick={() => setView("overview")}>← Back to your campaign</Button>
              <ResearchView
              session={session}
              busy={busy}
              send={send}
              create={() => setView("overview")}
              action={action}
              />
            </>
          ) : (
            <>
              <div className="actions view-links">
                <Button onClick={() => setView("research")}>
                  Research findings
                </Button>
                {session.brief && (
                  <Button disabled={busy} onClick={openBrief}>Edit brief</Button>
                )}
              </div>
              {(generating || starting) && <CampaignProgress
                key={session.researchState?.generationIntent?.requestId || initialGeneration?.requestId || "starting"}
                session={session}
                busy={busy}
                error={actionError || refreshError}
                recover={recover}
                inspect={() => setView("research")}
                refresh={() => void refresh()}
                retryStart={!session.researchState?.generationIntent && pendingGeneration ? () => {
                  void action({ action: "generateCampaign", ...pendingGeneration });
                } : undefined}
              />}
              {!session.variants.length && !generating && !starting && session.research && <CampaignDirection research={session.research} busy={busy} generate={generate} />}
              {!!session.variants.length && <AdsView
                session={session}
                selected={selected}
                select={setSelected}
                feedback={feedback}
                create={newCampaign}
                busy={busy}
                action={action}
              />}
              {!!session.research?.products?.length && <CampaignProducts
                key={session.research.id}
                research={session.research}
                busy={busy}
                save={(members) => action({ action: "setCampaignScope", members })}
                generate={(member) => void action({ action: "generateCampaignMember", requestId: crypto.randomUUID(), ...member })}
              />}
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
