import type { Direction } from "./contracts";
import type { Research } from "../session-types";
import { canonicalUrl, pageHint, storeHost } from "./extract";

/** Only actual request text / selected IDs grant scope, never a model tool argument. */
export function userResearchIntent(text: string, messageId?: string, research?: Research): { urls: string[]; direction?: Direction; choiceId?: string } {
  const urls = [...text.matchAll(/(?:https?:\/\/[^\s<>"')]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')]*)?)/gi)].flatMap(match => { try { return [canonicalUrl(match[0].replace(/[.,;!?]+$/, "").replace(/^(?!https?:\/\/)/, "https://"))]; } catch { return []; } });
  const scopeText = text.replace(/\b(?:do not|don['’]?t)\s+(?:generate|make|create)\s+(?:an?\s+)?(?:ad|image|brief)[^.!?]*(?:[.!?]|$)/gi, "");
  const ambiguous = /\b(?:don['’]?t|do not|not yet|what if|hypothetical|maybe|could we|should we|would it|instead of)\b/i.test(scopeText);
  if (ambiguous) return { urls: [] };
  const choiceId = text.match(/\[direction:([a-z0-9_]+)\]/)?.[1];
  const choice = research?.suggestions?.find(item => item.id === choiceId);
  if (choice) return { urls: [choice.url], choiceId, direction: { text: choice.label, origin: "choice", choiceId, url: choice.url, messageId } };
  const specific = urls.find(url => ["product", "collection"].includes(pageHint(url)));
  if (specific) return { urls, direction: { text: text.slice(0, 2000), origin: "specific_url", url: specific, messageId } };
  const explicit = scopeText.match(/(?:^|[.!?]\s*|,\s*|\band\s+)(?:please\s+|I (?:want to|would like to)\s+)?(?:promote|advertise|feature|focus on|research this product|choose|select)\s+(.+)/i);
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
