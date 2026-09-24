import type { ModelMessage, UIMessage } from "ai";

/** Failed calls remain in UI history, but malformed arguments must not reach providers. */
export function modelHistory(messages: ModelMessage[]): ModelMessage[] {
  const failed = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call" && (!part.input || typeof part.input !== "object" || Array.isArray(part.input))) failed.add(part.toolCallId);
      if (part.type === "tool-result" && ["error-text", "error-json"].includes(part.output.type)) failed.add(part.toolCallId);
    }
  }
  return messages.flatMap(message => {
    if (message.role !== "assistant" && message.role !== "tool") return [message];
    if (typeof message.content === "string") return message.content.trim() ? [message] : [];
    const content = message.content.filter(part => !("toolCallId" in part && failed.has(part.toolCallId)));
    return content.length ? [{ ...message, content } as ModelMessage] : [];
  });
}

/** Upgrade persisted SDK error parts before validation or rendering. */
export function normalizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(message => ({
    ...message,
    parts: message.parts.map(part => {
      if (!("rawInput" in part)) return part;
      const { rawInput, ...current } = part;
      if ("state" in current && current.state === "output-error") {
        return { ...current, input: ("input" in current ? current.input : undefined) ?? rawInput } as UIMessage["parts"][number];
      }
      return current as UIMessage["parts"][number];
    }),
  }));
}
