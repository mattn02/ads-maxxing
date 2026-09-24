import assert from "node:assert/strict";
import { test } from "node:test";
import { observed, type Progress } from "../lib/workflow/diagnostics";
import { safeError } from "../lib/workflow/validation";
import { ToolChoiceViolationError } from "ai";

test("tool-choice omissions explain the model failure without blaming credentials", () => {
  const error = new ToolChoiceViolationError({ toolChoice: { type: "tool", toolName: "submitResult" }, finishReason: "stop", provider: "gateway", modelId: "test", content: [{ type: "text", text: "private output" }] });
  for (const failure of [error, new Error("wrapped", { cause: error })]) {
    assert.match(safeError(failure), /required structured findings/);
    assert.doesNotMatch(safeError(failure), /credentials|connectivity|private output/);
  }
});

test("optional model failure completes with a warning while retaining server diagnostics", async () => {
  const events: Progress[] = [];
  await assert.rejects(observed("vision-model", "Checking photos", async () => { throw new Error("private output"); }, async event => { events.push(event); }, { optional: true }));
  assert.deepEqual(events.map(event => event.status), ["started", "completed"]);
  assert.match(events[1].detail, /Optional check unavailable; continuing/);
  assert.doesNotMatch(events[1].detail, /private output/);
});

test("nested provider failures retain actionable metadata without leaking payloads", () => {
  assert.match(safeError(new Error("secret", { cause: { statusCode: 429 } })), /request limit/);
  assert.match(safeError(new Error("secret", { cause: { code: "ECONNRESET" } })), /ECONNRESET/);
  assert.match(safeError(new DOMException("secret", "TimeoutError")), /time limit/);
  assert.doesNotMatch(safeError({ statusCode: 401, responseBody: "secret" }), /secret/);
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(typeof safeError(cyclic), "string");
});

test("research stage failure is recorded and exposes a matching reference without raw provider data", async () => {
  const events: Progress[] = [];
  await assert.rejects(observed("synthesis", "Inferring brand voice", async () => {
    throw new Error("private request body", { cause: { statusCode: 429 } });
  }, async event => { events.push(event); }), error => {
    assert.match((error as Error).message, /Inferring brand voice.*request limit.*reference/);
    assert.equal((error as Error).message, events[1].detail);
    assert.doesNotMatch((error as Error).message, /private request body/);
    return true;
  });
  assert.deepEqual(events.map(event => event.status), ["started", "failed"]);
});

test("successful stages preserve results and record elapsed time", async () => {
  const events: Progress[] = [];
  assert.equal(await observed("checkpoint", "Saving findings", async () => 42, async event => { events.push(event); }), 42);
  assert.deepEqual(events.map(event => event.status), ["started", "completed"]);
  assert.match(events[1].detail, /\d+\.\ds/);
});
