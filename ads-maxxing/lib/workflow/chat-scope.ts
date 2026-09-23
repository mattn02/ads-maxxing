import type { UIMessage } from "ai";

type ScopedMessage = UIMessage<{ variantId?: string }>;

/** Legacy campaign chat stays saved, but never appears in an ad conversation. */
export function messagesForVariant(messages: UIMessage[], variantId: string): UIMessage[] {
  return messages.filter(message => (message as ScopedMessage).metadata?.variantId === variantId);
}

export function tagMessageForVariant<T extends UIMessage>(message: T, variantId: string): T {
  return { ...message, metadata: { ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}), variantId } };
}

/** Append only this turn's new messages; preserve all other ad conversations. */
export function mergeVariantTurn(all: UIMessage[], history: UIMessage[], returned: UIMessage[], variantId: string): UIMessage[] {
  const existing = new Set(all.map(message => message.id));
  const additions = returned.slice(history.length).filter(message => !existing.has(message.id));
  return [...all, ...additions.map(message => tagMessageForVariant(message, variantId))];
}
