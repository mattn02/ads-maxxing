import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolChoiceViolationError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { structuredResult } from "../lib/workflow/structured-result";
import { safeError } from "../lib/workflow/validation";
import { visualReviewSchema } from "../lib/workflow/schema";

function textModel(text: string, finishReason: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text }], finishReason: { unified: finishReason, raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } }, warnings: [],
  }) });
}
const schema = z.object({ reason: z.string().min(1), passed: z.boolean() });
const request = { schema, instructions: "Assess the image.", messages: [{ role: "user" as const, content: "Evidence" }] };

test("findings accept text JSON through the real SDK boundary without requiring a tool call", async () => {
  const model = textModel('{"reason":"Visible","passed":true}');
  assert.deepEqual(await structuredResult({ ...request, model }), { reason: "Visible", passed: true });
  assert.equal(model.doGenerateCalls.length, 1);
  const call = model.doGenerateCalls[0];
  assert.equal(call.tools, undefined);
  assert.equal(call.toolChoice?.type, "auto");
  assert.equal(call.responseFormat, undefined);
  assert.match(JSON.stringify(call.prompt), /JSON schema/);
});

test("provider structured output sends the schema and returns its validated object", async () => {
  const model = textModel('{"reason":"Visible","passed":true}');
  assert.deepEqual(await structuredResult({ ...request, model, providerStructuredOutput: true }), { reason: "Visible", passed: true });
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doGenerateCalls[0].responseFormat?.type, "json");
  assert.equal(model.doGenerateCalls[0].tools, undefined);
});

test("provider structured output sanitizes invalid model data without retrying", async t => {
  const logs: string[] = [];
  t.mock.method(console, "warn", (message: string) => { logs.push(message); });
  const model = textModel('{"reason":"Visible","passed":"yes"}');
  await assert.rejects(structuredResult({ ...request, model, providerStructuredOutput: true }), /invalid structured findings/);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(JSON.parse(logs[0]).mode, "provider");
  assert.doesNotMatch(logs[0], /Visible|yes/);
});

test("final review validates its real schema using file image inputs", async () => {
  const criterion = { status: "uncertain", reason: "Needs human inspection" };
  const visual = { productFidelity: criterion, textLegibility: criterion, claimAccuracy: criterion, brandFit: criterion, summary: "Inspect the original" };
  const model = textModel(JSON.stringify(visual));
  await structuredResult({ model, schema: visualReviewSchema, instructions: "Inspect the image", messages: [{ role: "user", content: [{ type: "file", data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }] }] });
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /image\/png/);
  assert.equal(model.doGenerateCalls.length, 1);
});

test("a complete JSON fence is accepted but malformed, invalid and pseudo-tool findings are rejected without retries", async () => {
  assert.deepEqual(await structuredResult({ ...request, model: textModel('```json\n{"reason":"Visible","passed":false}\n```') }), { reason: "Visible", passed: false });
  for (const text of ['{"reason":', '{"passed":"yes","reason":"private"}', 'submitResult({"reason":"Visible","passed":true})', 'Here is JSON: {"reason":"Visible","passed":true}', '']) {
    const model = textModel(text);
    await assert.rejects(structuredResult({ ...request, model }), error => {
      assert.match((error as Error).message, /findings/);
      assert.doesNotMatch((error as Error).message, /private/);
      return true;
    });
    assert.equal(model.doGenerateCalls.length, 1);
  }
});

test("provider tool-choice violations cross the helper boundary safely without recovery calls", async () => {
  const failure = new ToolChoiceViolationError({ toolChoice: { type: "tool", toolName: "submitResult" }, finishReason: "stop", provider: "gateway", modelId: "test", content: [{ type: "text", text: "private response" }] });
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw failure; } });
  await assert.rejects(structuredResult({ ...request, model }), error => {
    assert.equal(error, failure);
    assert.match(safeError(error), /required structured findings/);
    assert.doesNotMatch(safeError(error), /private|credentials|connectivity/);
    return true;
  });
  assert.equal(model.doGenerateCalls.length, 1);
});

test("invalid findings log only bounded format metadata, never response text", async t => {
  const logs: string[] = [];
  t.mock.method(console, "warn", (message: string) => { logs.push(message); });
  await assert.rejects(structuredResult({ ...request, model: textModel("private response content") }));
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), { event: "structured-findings-invalid", finishReason: "stop", outputTokens: 10, textCharacters: 24 });
  assert.doesNotMatch(logs[0], /private response/);
});


test("caller-specific reviewer budget is forwarded while ordinary findings retain their limit", async () => {
  const { REVIEW_OUTPUT_TOKENS } = await import("../lib/workflow/agents/reviewer");
  for (const budget of [undefined, REVIEW_OUTPUT_TOKENS]) {
    const model = textModel('{"reason":"Visible","passed":true}');
    await structuredResult({ ...request, model, maxOutputTokens: budget });
    assert.equal(model.doGenerateCalls[0].maxOutputTokens, budget ?? 2200);
    assert.equal(model.doGenerateCalls.length, 1);
  }
  assert.equal(REVIEW_OUTPUT_TOKENS, 4096);
});

test("provider-reported truncation is distinct and never repairs or retries partial findings", async t => {
  const logs: string[] = [];
  t.mock.method(console, "warn", (message: string) => { logs.push(message); });
  for (const response of ['{"reason":', '{"reason":"Visible","passed":true}']) {
    const model = textModel(response, "length");
    await assert.rejects(structuredResult({ ...request, model, maxOutputTokens: 4096 }), /cut off at the output limit/);
    assert.equal(model.doGenerateCalls.length, 1);
  }
  assert.ok(logs.every(value => JSON.parse(value).finishReason === "length"));
});
