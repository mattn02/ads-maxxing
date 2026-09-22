"use client";
/* eslint-disable @next/next/no-img-element -- Local PoC previews use arbitrary store image URLs. */
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import { BriefEditor } from "./components/brief-editor";
import type { Session } from "@/lib/workflow/session-types";

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
export function WorkflowConsole({ initialSessions }: { initialSessions: { id: string; title: string }[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function open(id?: string) {
    setBusy(true); setError("");
    try {
      setSession(await request<Session>(id ? `/api/sessions/${id}` : "/api/sessions", id ? undefined : {}));
      setSessions(await request("/api/sessions"));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main>
    <h1>Agent workflow PoC</h1>
    <p>Concierge → research → approve brief → artist → reviewer. Local files, one image per approved revision.</p>
    <button disabled={busy} onClick={() => void open()}>New session</button>{" "}
    <select aria-label="Resume session" disabled={busy} value={session?.id || ""} onChange={event => void open(event.target.value)}>
      <option value="" disabled>Resume a saved session</option>
      {sessions.map(item => <option key={item.id} value={item.id}>{item.title} · {item.id.slice(0, 8)}</option>)}
    </select>
    {error && <p role="alert">{error}</p>}
    {session ? <Chat key={session.id} initial={session} /> : <p>Start a session and ask: “Research https://www.loopycases.com and draft an ad.” Include a product or campaign URL to narrow the research.</p>}
  </main>;
}
function Chat({ initial }: { initial: Session }) {
  const [session, setSession] = useState(initial);
  const [input, setInput] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  async function refresh() {
    try { setSession(await request<Session>(`/api/sessions/${initial.id}`)); }
    catch (error) { setActionError((error as Error).message); }
  }
  const { messages, sendMessage, status, error } = useChat<ConciergeMessage>({
    id: initial.id, messages: initial.messages as ConciergeMessage[],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, message: messages[messages.length - 1] } }),
    }),
    onFinish: () => { void refresh(); },
    onError: () => { void refresh(); },
  });
  const busy = actionBusy || status === "submitted" || status === "streaming";
  async function action(body: unknown) {
    setActionBusy(true); setActionError("");
    try { setSession(await request<Session>(`/api/sessions/${initial.id}`, body)); }
    catch (error) { setActionError((error as Error).message); await refresh(); }
    finally { setActionBusy(false); }
  }
  return <>
    <section aria-label="Chat">
      {messages.map(message => <article key={message.id}>
        <strong>{message.role === "user" ? "You" : "Concierge"}</strong>
        {message.parts.map((part, index) => part.type === "text" ? <p key={index} style={{ whiteSpace: "pre-wrap" }}>{part.text}</p> : part.type.startsWith("tool-") ? <details key={index}><summary>{part.type.slice(5)} · {"state" in part ? String(part.state) : ""}</summary><pre>{JSON.stringify(part, null, 2)}</pre></details> : null)}
      </article>)}
      <form onSubmit={event => { event.preventDefault(); if (input.trim()) { void sendMessage({ text: input }); setInput(""); } }}>
        <label htmlFor="chat">Message or feedback</label>
        <textarea id="chat" rows={3} maxLength={8000} disabled={busy} value={input} onChange={event => setInput(event.target.value)} placeholder="Research https://www.loopycases.com and draft an ad." />
        <button disabled={busy || !input.trim()}>Send</button>
      </form>
      <p role="status">{busy ? "Working… research and image generation can take a few minutes." : "Ready"}</p>
      {(error || actionError || session.lastError) && <p role="alert">{actionError || error?.message || session.lastError}</p>}
    </section>
    {session.research && <section>
      <h2>Research</h2>
      <p>Voice (inferred): {session.research.voice}</p>
      <p>Audience (inferred): {session.research.audience}</p>
      <p>Colors: {session.research.colors.map(color => color.value).join(", ") || "Unknown"}</p>
      <p>Sales: {session.research.sales.length ? "Source quotes below; confirm applicability before using." : "None supported by source evidence."}</p>
      {session.research.sales.map(sale => <p key={sale.id}>“{sale.quote}” — <a href={sale.sourceUrl} target="_blank" rel="noreferrer">source</a></p>)}
      {session.research.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <details><summary>Saved research and source text</summary><pre>{JSON.stringify(session.research, null, 2)}</pre></details>
    </section>}
    {session.brief && <BriefEditor key={session.brief.id} brief={session.brief} session={session} busy={busy} action={action} generate={() => { void action({ action: "generateAd", briefId: session.brief!.id }); }} />}
    {!!session.variants.length && <section><h2>Variants</h2>
      {[...session.variants].reverse().map(variant => <article key={variant.id}>
        <p><strong>{variant.status}</strong> · {variant.id.slice(0, 8)}</p>
        <img className="output" src={variant.imageUrl} alt={variant.brief.headline} />
        <p><a href={variant.imageUrl} download={`${variant.id}.png`}>Download PNG</a></p>
        <p>{variant.review?.visual.summary || variant.reviewError || "Waiting for review"}</p>
        {variant.review && <pre>{JSON.stringify(variant.review, null, 2)}</pre>}
        <button disabled={busy || variant.status !== "review_failed"} onClick={() => void action({ action: "reviewAd", variantId: variant.id })}>Retry failed review</button>{" "}
        <button disabled={busy || variant.status !== "reviewed"} onClick={() => void action({ action: "approveAd", variantId: variant.id })}>Approve ad</button>{" "}
        <button disabled={busy} onClick={() => setInput(`Revise variant ${variant.id}: `)}>Give feedback</button>
        <details><summary>Saved generation inputs</summary><pre>{JSON.stringify({ brief: variant.brief, model: variant.model, prompt: variant.prompt, visualAssetId: variant.visualAssetId, design: variant.design, tokens: variant.tokens, rendererVersion: variant.rendererVersion }, null, 2)}</pre></details>
      </article>)}
    </section>}
    <details><summary>Preferences and workflow events</summary><pre>{JSON.stringify({ preferences: session.preferences, events: session.events }, null, 2)}</pre></details>
    <button disabled={busy} onClick={() => void refresh()}>Refresh saved state</button>
  </>;
}
