"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ConciergeMessage } from "@/lib/workflow/agents/concierge";
import { messagesForVariant } from "@/lib/workflow/chat-scope";
import type { Session, Variant } from "@/lib/workflow/session-types";
import { ChatPanel } from "./chat";

export function AdChat({ session, variant, busy, onBusyChange, refresh, openBrief }: {
  session: Session;
  variant: Variant;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  refresh: () => void | Promise<unknown>;
  openBrief: () => void;
}) {
  const [input, setInput] = useState("");
  const [settling, setSettling] = useState(false);
  const [initialMessages] = useState(() => messagesForVariant(session.messages, variant.id) as ConciergeMessage[]);
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { id: session.id, variantId: variant.id, message: messages[messages.length - 1] },
    }),
  }), [session.id, variant.id]);
  const { messages, sendMessage, status, error } = useChat<ConciergeMessage>({
    id: `${session.id}:${variant.id}`,
    messages: initialMessages,
    transport,
    onFinish: async () => {
      try { await refresh(); }
      finally { setSettling(false); }
    },
    onError: async () => {
      try { await refresh(); }
      finally { setSettling(false); }
    },
  });
  const chatBusy = status === "submitted" || status === "streaming" || settling;
  useEffect(() => onBusyChange(chatBusy), [chatBusy, onBusyChange]);
  function send(text: string) {
    if (busy || chatBusy || !text.trim()) return;
    setSettling(true);
    setInput("");
    void sendMessage({ text: text.trim() });
  }
  return <ChatPanel
    session={session}
    variant={variant}
    messages={messages}
    input={input}
    setInput={setInput}
    send={send}
    busy={busy || chatBusy}
    error={error?.message}
    openBrief={openBrief}
    refresh={() => void refresh()}
  />;
}
