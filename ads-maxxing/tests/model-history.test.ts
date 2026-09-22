import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelMessage } from "ai";
import { modelHistory } from "../lib/workflow/messages";

test("malformed brief arguments and matching errors never replay to the provider", () => {
  const history: ModelMessage[] = [
    { role: "user", content: "Prepare a brief" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "bad", toolName: "prepareBrief", input: '{"design": {' }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "bad", toolName: "prepareBrief", output: { type: "error-text", value: "Invalid input" } }] },
    { role: "assistant", content: "The brief could not be prepared." },
    { role: "user", content: "Use a clean studio direction." },
    { role: "assistant", content: [] },
  ];
  const original = structuredClone(history);
  assert.deepEqual(modelHistory(history), [history[0], history[3], history[4]]);
  assert.deepEqual(history, original);
});

test("valid tool exchanges survive alongside a failed call in the same step", () => {
  const history: ModelMessage[] = [
    { role: "assistant", content: [
      { type: "tool-call", toolCallId: "ok", toolName: "rememberPreference", input: { key: "offer", value: "none" } },
      { type: "tool-call", toolCallId: "bad", toolName: "prepareBrief", input: {} },
    ] },
    { role: "tool", content: [
      { type: "tool-result", toolCallId: "ok", toolName: "rememberPreference", output: { type: "json", value: { saved: true } } },
      { type: "tool-result", toolCallId: "bad", toolName: "prepareBrief", output: { type: "error-json", value: { error: "invalid" } } },
    ] },
  ];
  const cleaned = modelHistory(history);
  assert.equal(cleaned.length, 2);
  assert.ok(JSON.stringify(cleaned).includes('"ok"'));
  assert.ok(!JSON.stringify(cleaned).includes('"bad"'));
});

test("concierge cleans persisted invalid brief history before calling the model", async () => {
  const { createAgentUIStreamResponse, simulateReadableStream } = await import("ai");
  const { MockLanguageModelV4 } = await import("ai/test");
  const { createConcierge } = await import("../lib/workflow/agents/concierge");
  const { Workflow } = await import("../lib/workflow/service");
  const model = new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ chunks: [
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } },
  ] }) } });
  const workflow = new Workflow({ id: "test", createdAt: "now", updatedAt: "now", messages: [], preferences: {}, variants: [], events: [] });
  const response = await createAgentUIStreamResponse({ agent: createConcierge(workflow, model), uiMessages: [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Prepare a brief" }] },
    { id: "a1", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "prepareBrief", toolCallId: "invalid-brief", state: "output-error", input: '{"headline":', errorText: "Invalid input" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Try again" }] },
  ] });
  await response.text();
  assert.equal(model.doStreamCalls.length, 1);
  assert.doesNotMatch(JSON.stringify(model.doStreamCalls[0].prompt), /invalid-brief/);
});
