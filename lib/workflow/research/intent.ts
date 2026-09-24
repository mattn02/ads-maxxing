import type { Direction } from "./contracts";
import type { Research } from "../session-types";
import { canonicalUrl, pageHint, storeHost } from "./extract";

/** Only actual request text / selected IDs grant scope, never a model tool argument. */
export function userResearchIntent(text: string, messageId?: string, research?: Research): { urls: string[]; direction?: Direction; choiceId?: string } {
  const urls = [...text.matchAll(/(?:https?:\/\/[^\s<>"')]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')]*)?)/gi)].flatMap(match => { try { return [canonicalUrl(match[0].replace(/[.,;!?]+$/, "").replace(/^(?!https?:\/\/)/, "https://"))]; } catch { return []; } });
  const scopeText = text.replace(/\b(?:do not|don['’]?t)\s+(?:generate|make|create)\s+(?:an?\s+)?(?:ad|image|brief)[^.!?]*(?:[.!?]|$)/gi, "");
  const ambiguous = /\b(?:don['’]?t|do not|not yet|what if|hypothetical|maybe|could we|should we|would it|instead of)\b/i.test(scopeText);
  if (ambiguous || /\?/.test(scopeText.replace(/https?:\/\/[^\s]+/g, "")) || /^(?:what|why|how|can|could|should|would|is|are|does)\b/i.test(scopeText.trim())) return { urls: [] };
  const choiceId = text.match(/\[direction:([^\]\s]+)\]/)?.[1];
  const normalized = scopeText.toLowerCase().trim().replace(/[.!]+$/, "").replace(/^(?:let['’]s (?:do|try|start with)|go with|i['’]d like|i want|the)\s+/, "").replace(/\s+(?:please|one|option)$/, "");
  const ordinal = ["first", "second", "third"].indexOf(normalized);
  const matches = research?.suggestions?.filter(item => item.label.toLowerCase() === normalized) || [];
  const choice = choiceId ? research?.suggestions?.find(item => item.id === choiceId) : ordinal >= 0 ? research?.suggestions?.[ordinal] : matches.length === 1 ? matches[0] : undefined;
  if (choiceId && !choice) return { urls: [], choiceId };
  if (choice) return { urls: [choice.url], choiceId: choice.id, direction: { text: choice.label, origin: "choice", choiceId: choice.id, url: choice.url, messageId } };
  const specific = urls.find(url => ["product", "collection", "unknown"].includes(pageHint(url)));
  if (specific) return { urls, direction: { text: text.slice(0, 2000), origin: "specific_url", url: specific, messageId } };
  const explicit = scopeText.match(/(?:^|[.!?]\s*|,\s*|\band\s+)(?:please\s+|let['’]s\s+|I (?:want to|would like to)\s+|I['’]d like to\s+)?(?:promote|advertise|feature|focus on|research this product|choose|select|start with|try)\s+(.+)/i);
  if (explicit && !/^(?:something|anything|whatever|a product|one|it|that|this)[.!?]?$/i.test(explicit[1].trim())) return { urls, direction: { text: explicit[0].slice(0, 2000), origin: "user_message", messageId } };
  return { urls };
}
export function matchingLinks(research: Research | undefined, direction: Direction, candidates: string[]): string[] {
  const store = research?.brandKit?.canonicalStoreUrl;
  const tokens = direction.text.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(word => !["research", "promote", "advertise", "feature", "product", "collection", "please", "this", "with", "from", "the"].includes(word)) || [];
  return [...new Set(candidates)].filter(url => (!store || storeHost(url) === storeHost(store)) && ["product", "collection"].includes(pageHint(url)))
    .map(url => ({ url, score: tokens.filter(token => decodeURIComponent(url).toLowerCase().includes(token)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).map(item => item.url);
}
