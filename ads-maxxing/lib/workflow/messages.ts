import type { UIMessage } from "ai";

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
