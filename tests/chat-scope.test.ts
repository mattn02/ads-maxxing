import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";
import { mergeVariantTurn, messagesForVariant, tagMessageForVariant } from "../lib/workflow/chat-scope";

const message = (id: string, role: "user" | "assistant", text: string): UIMessage => ({ id, role, parts: [{ type: "text", text }] });

test("switching ads restores only that ad's saved conversation", () => {
  const oldCampaign = message("legacy", "assistant", "old shared chat");
  const a = tagMessageForVariant(message("a1", "user", "make it brighter"), "ad-a");
  const b = tagMessageForVariant(message("b1", "user", "different product"), "ad-b");
  const saved = [oldCampaign, a, b];
  assert.deepEqual(messagesForVariant(saved, "ad-a").map(item => item.id), ["a1"]);
  assert.deepEqual(messagesForVariant(saved, "ad-b").map(item => item.id), ["b1"]);
  assert.deepEqual(messagesForVariant(saved, "ad-new"), []);
});

test("saving a streamed turn keeps other ad and legacy messages", () => {
  const a = tagMessageForVariant(message("a1", "user", "change color"), "ad-a");
  const b = tagMessageForVariant(message("b1", "user", "change headline"), "ad-b");
  const incoming = tagMessageForVariant(message("a2", "user", "show me a softer scene"), "ad-a");
  const all = [a, b, incoming];
  const history = [a, incoming];
  const saved = mergeVariantTurn(all, history, [...history, message("a3", "assistant", "Brief saved")], "ad-a");
  assert.deepEqual(saved.map(item => item.id), ["a1", "b1", "a2", "a3"]);
  assert.deepEqual(messagesForVariant(saved, "ad-a").map(item => item.id), ["a1", "a2", "a3"]);
  assert.deepEqual(messagesForVariant(saved, "ad-b").map(item => item.id), ["b1"]);
});
