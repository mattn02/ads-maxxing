import { productResearch } from "./research-fixture";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import { assembleResearch } from "../lib/workflow/agents/researcher";
import { artistPrompt } from "../lib/workflow/agents/artist";
import { codeChecks, reviewVerdict } from "../lib/workflow/agents/reviewer";
import { createSession, loadSession, lockSession, saveSession, listSessions } from "../lib/workflow/sessions";
import type { Research, Session, Source, Variant } from "../lib/workflow/session-types";
import { researchInputSchema, findingsSchema, type BriefInput, type VisualReview } from "../lib/workflow/schema";
import { normalizeMessages } from "../lib/workflow/messages";
import { conciergeText } from "../lib/workflow/concierge-stream";
import { safeError } from "../lib/workflow/validation";
import { structuredResult } from "../lib/workflow/structured-result";
import type { UIMessage } from "ai";
import { generateImage } from "../lib/workflow/fal";
import { scrapePage } from "../lib/workflow/firecrawl";
import { readImage, saveGeneration } from "../lib/workflow/storage";

const source: Source = { url: "https://store.example/products/case", title: "Real case", description: "A red case", images: ["https://store.example/case.png"], markdown: "Members get 10% off red cases through Friday.", colors: { primary: "#ff0000" }, fetchedAt: new Date().toISOString() };
const makeResearch = (): Research => productResearch(structuredClone(source));
const brief: BriefInput = { productId: makeResearch().products![0].id, referenceAssetId: makeResearch().assets![0].id, design: { ...DEFAULT_DESIGN }, productUrl: source.url, referenceImage: source.images[0], headline: "Hold on to color", cta: "Shop now", direction: "Simple red background", saleId: null, feedback: "", parentVariantId: null };
const passing = { status: "pass" as const, reason: "Matches supplied evidence." };
const visual: VisualReview = { productFidelity: passing, textLegibility: passing, claimAccuracy: passing, brandFit: passing, summary: "Matches source and brief." };
function fixture(overrides: Partial<WorkflowDependencies> = {}) {
  const session: Session = { id: randomUUID(), createdAt: "now", updatedAt: "now", messages: [], preferences: {}, variants: [], events: [] };
  let generations = 0;
  const workflow = new Workflow(session, {
    research: async () => makeResearch(), save: async () => {}, readVisual: async () => null,
    createAd: async current => { generations++; return { id: randomUUID(), imageUrl: "/api/outputs/test", model: "test", prompt: artistPrompt(current), referenceImage: current.referenceImage, createdAt: "now" }; },
    reviewAd: async () => ({ verdict: "pass", visual, checks: [], createdAt: "now" }), ...overrides,
  });
  return { workflow, session, generationCount: () => generations };
}
async function draft(workflow: Workflow) {
  await workflow.research({ url: source.url, productUrl: null, campaignUrl: null });
  return workflow.proposeBrief(brief);
}

test("research rejects invented sale evidence and retains source provenance", () => {
  const result = assembleResearch([source], { voice: "Playful", audience: "Inferred", sales: [
    { description: "Member sale", sourceUrl: source.url, quote: source.markdown },
    { description: "Fake sale", sourceUrl: source.url, quote: "Everyone gets 90% off" },
  ] });
  assert.equal(result.sales.length, 1);
  assert.equal(result.sales[0].quote, source.markdown);
  assert.equal(result.colors[0].sourceUrl, source.url);
  assert.equal(result.warnings.length, 1);
});

test("approval is enforced, tied to a revision, and cannot be fabricated by draft fields", async () => {
  const { workflow, generationCount } = fixture();
  const first = await draft(workflow);
  await assert.rejects(workflow.generate(), /Approve/);
  await workflow.approveBrief(first.id);
  const next = await workflow.proposeBrief({ ...brief, headline: "Updated", ...{ approvedAt: "fake" } });
  assert.equal(next.approvedAt, undefined);
  await assert.rejects(workflow.approveBrief(first.id), /changed/);
  await assert.rejects(workflow.generate(), /Approve/);
  assert.equal(generationCount(), 0);
});

test("direct generation rejects a stale brief ID before a paid request", async () => {
  const { workflow, generationCount } = fixture();
  const first = await draft(workflow);
  await workflow.approveBrief(first.id);
  const next = await workflow.proposeBrief({ ...brief, headline: "New revision" });
  await workflow.approveBrief(next.id);
  await assert.rejects(workflow.generate(first.id), /brief changed/);
  assert.equal(generationCount(), 0);
  const output = await workflow.generate(next.id);
  assert.equal((await workflow.generate(next.id)).id, output.id);
  assert.equal(generationCount(), 1);
});

test("only scraped photos and evidenced sale IDs can enter a brief", async () => {
  const { workflow } = fixture();
  await draft(workflow);
  await assert.rejects(workflow.proposeBrief({ ...brief, referenceAssetId: "invented", referenceImage: "https://invented.example/product.png" }), /references/);
  await assert.rejects(workflow.proposeBrief({ ...brief, saleId: "invented" }), /offer/);
  await assert.rejects(workflow.proposeBrief({ ...brief, parentVariantId: "invented" }), /Parent variant/);
});

test("briefs accept absent IDs encoded as strings without bypassing approval", async () => {
  const { workflow } = fixture();
  await draft(workflow);
  for (const value of ["null", " NULL ", "None", "none", "", "  ", null]) {
    const saved = await workflow.proposeBrief({ ...brief, saleId: value, parentVariantId: value });
    assert.equal(saved.saleId, null);
    assert.equal(saved.parentVariantId, null);
    assert.equal(saved.approvedAt, undefined);
    await assert.rejects(workflow.generate(), /Approve/);
  }
});

test("brief IDs resolve exact saved URLs and reject another product's asset", async () => {
  const { workflow, session } = fixture();
  await draft(workflow);
  session.research!.assets![0].originalUrl = "https://store.example/case.png?v=123&width=3840";
  const saved = await workflow.proposeBrief({ ...brief, productUrl: "https://invented.example/", referenceImage: "https://invented.example/a.png" });
  assert.equal(saved.productUrl, source.url);
  assert.equal(saved.referenceImage, "https://store.example/case.png?v=123&width=3840");
  session.research!.assets![0].productIds = ["other-product"];
  await assert.rejects(workflow.proposeBrief(brief), /selected product/);
});

test("one approved revision generates once; feedback changes the next prompt and keeps ancestry", async () => {
  const { workflow, session, generationCount } = fixture();
  const first = await draft(workflow);
  await workflow.approveBrief(first.id);
  const output = await workflow.generate();
  assert.equal(output.status, "reviewed");
  assert.equal((await workflow.generate()).id, output.id);
  assert.equal(generationCount(), 1);
  const next = await workflow.proposeBrief({ ...brief, feedback: "Use a cream background", direction: "Cream background", design: { ...DEFAULT_DESIGN, visualDirection: "Use a cream background" }, parentVariantId: output.id });
  await assert.rejects(workflow.generate(), /Approve/);
  await workflow.approveBrief(next.id);
  const second = await workflow.generate();
  assert.match(second.prompt, /Use a cream background/);
  assert.equal(second.brief.parentVariantId, output.id);
  assert.equal(session.variants.length, 2);
  assert.equal(output.brief.headline, brief.headline);
});

test("review failure retains image; retrying review never regenerates", async () => {
  let attempts = 0;
  const { workflow, session, generationCount } = fixture({ reviewAd: async () => {
    if (++attempts === 1) throw new Error("Provider secret must not leak");
    return { verdict: "needs_changes", visual, checks: [], createdAt: "now" };
  } });
  const first = await draft(workflow);
  await workflow.approveBrief(first.id);
  const output = await workflow.generate();
  assert.equal(output.status, "review_failed");
  assert.equal(session.variants.length, 1);
  assert.doesNotMatch(output.reviewError!, /secret/);
  await workflow.review(output.id);
  assert.equal(output.status, "needs_changes");
  assert.equal(generationCount(), 1);
  await assert.rejects(workflow.approveVariant(output.id), /Resolve/);
});

test("failed generation is marked before calling fal and cannot automatically retry", async () => {
  let calls = 0;
  const { workflow, session } = fixture({ createAd: async () => {
    assert.ok(session.brief?.generationAttemptedAt);
    calls++;
    throw new Error("timeout");
  } });
  const first = await draft(workflow);
  await workflow.approveBrief(first.id);
  await assert.rejects(workflow.generate(), /timeout/);
  await assert.rejects(workflow.generate(), /already attempted/);
  assert.equal(calls, 1);
  assert.equal(session.events.at(-1)?.status, "failed");
});

test("new preferences and research invalidate approval without deleting previous variants", async () => {
  const { workflow, session } = fixture();
  const first = await draft(workflow);
  await workflow.approveBrief(first.id);
  await workflow.remember("tone", "minimal");
  await assert.rejects(workflow.generate(), /Approve/);
  await workflow.approveBrief(first.id);
  await workflow.generate();
  await workflow.research({ url: source.url, productUrl: null, campaignUrl: null });
  assert.equal(session.brief, undefined);
  assert.equal(session.variants.length, 1);
  assert.equal(session.preferences.tone, "minimal");
});

test("review combines code and visual results; uncertainty never passes", async () => {
  const { workflow } = fixture();
  const first = await draft(workflow);
  await workflow.approveBrief(first.id);
  const variant: Variant = await workflow.generate();
  // Header-only fixture is sufficient for the deterministic dimension check.
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(576, 16); png.writeUInt32BE(1024, 20);
  const checks = codeChecks(variant, png);
  assert.ok(checks.every(check => check.passed));
  assert.equal(reviewVerdict(checks, visual), "pass");
  assert.equal(reviewVerdict(checks, { ...visual, productFidelity: { status: "uncertain", reason: "Obscured" } }), "needs_human");
  png.writeUInt32BE(100, 16);
  assert.equal(reviewVerdict(codeChecks(variant, png), visual), "needs_changes");
});

test("atomic session persistence reloads history and preferences; locks reject concurrent turns", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ad-workflow-test-"));
  process.env.WORKFLOW_DATA_DIR = dir;
  try {
    const session = await createSession();
    session.preferences.tone = "Friendly";
    session.messages.push({ id: "user1", role: "user", parts: [{ type: "text", text: "Remember friendly copy" }] });
    await saveSession(session);
    assert.deepEqual((await loadSession(session.id)).messages, session.messages);
    assert.equal((await loadSession(session.id)).preferences.tone, "Friendly");
    assert.equal((await listSessions()).length, 1);
    assert.equal((await readdir(path.join(dir, "sessions"))).filter(name => name.endsWith(".tmp")).length, 0);
    const release = lockSession(session.id);
    assert.throws(() => lockSession(session.id), /busy/);
    release(); lockSession(session.id)();
    await assert.rejects(loadSession("../../etc/passwd"), /Invalid/);
  } finally { delete process.env.WORKFLOW_DATA_DIR; await rm(dir, { recursive: true, force: true }); }
});

test("provider adapters forward real photo, use a square visual, request branding and save a local PNG", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "ad-adapter-test-"));
  process.env.WORKFLOW_DATA_DIR = dir;
  process.env.FAL_AI_API_KEY = "fixture";
  process.env.FIRECRAWL_API_KEY = "fixture";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=", "base64");
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("firecrawl.dev")) {
      const body = JSON.parse(init!.body as string);
      assert.ok(body.formats.includes("branding")); assert.equal(body.maxAge, 0); assert.equal(body.onlyMainContent, false);
      return Response.json({ success: true, data: { markdown: source.markdown, images: ["/case.png"], branding: { colors: source.colors }, metadata: { statusCode: 200, title: source.title } } });
    }
    if (String(url).includes("fal.run")) {
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.image_urls, [source.images[0]]);
      assert.deepEqual(body.image_size, { width: 576, height: 576 }); assert.equal(body.num_images, 1);
      return Response.json({ images: [{ url: "https://fal.media/fixture.png" }] });
    }
    return new Response(png);
  });
  try {
    assert.deepEqual((await scrapePage(source.url, true)).images, source.images);
    const generated = await generateImage(source.images[0], "Fixture ad");
    const saved = await saveGeneration({ ...generated, referenceImage: source.images[0], productUrl: source.url, prompt: "Fixture ad" });
    assert.deepEqual(await readImage(saved.id), png);
    assert.match(await readFile(path.join(dir, `${saved.id}.json`), "utf8"), /providerImageUrl/);
    assert.equal(await readImage("../secret"), null);
  } finally { t.mock.restoreAll(); delete process.env.WORKFLOW_DATA_DIR; delete process.env.FAL_AI_API_KEY; delete process.env.FIRECRAWL_API_KEY; await rm(dir, { recursive: true, force: true }); }
});

test("real AI SDK loop streams research and brief tool results, pauses for approval, and resumes generation", async () => {
  const { createAgentUIStreamResponse, simulateReadableStream } = await import("ai");
  const { MockLanguageModelV4 } = await import("ai/test");
  const { createConcierge } = await import("../lib/workflow/agents/concierge");
  const { workflow, session, generationCount } = fixture();
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
  const toolStep = (toolName: string, input: unknown, id: string) => ({ stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
    { type: "stream-start" as const, warnings: [] },
    { type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) },
    { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
  ] }) });
  const textStep = (text: string) => ({ stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
    { type: "text-start" as const, id: "text" }, { type: "text-delta" as const, id: "text", delta: text }, { type: "text-end" as const, id: "text" },
    { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
  ] }) });
  const model = new MockLanguageModelV4({ doStream: [
    toolStep("research", { url: `[Product](${source.url})`, productUrl: "", campaignUrl: "" }, "research1"),
    toolStep("prepareBrief", { ...brief, saleId: "null", parentVariantId: "null" }, "brief1"),
    textStep("Generating now. <tool_call>generateAd</tool_call>"),
  ] });
  session.messages.push({ id: "user1", role: "user", parts: [{ type: "text", text: "Research and draft an ad" }] });
  const agent = createConcierge(workflow, model);
  const response = await createAgentUIStreamResponse({ agent, experimental_transform: conciergeText(agent.responseText), uiMessages: session.messages, generateMessageId: randomUUID, onEnd: ({ messages }) => { session.messages = messages; } });
  const stream = await response.text();
  assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
  assert.match(stream, /tool-output-available/);
  assert.doesNotMatch(stream, /tool-input-error|rawInput/);
  assert.match(stream, /Approve brief and photo/);
  assert.doesNotMatch(stream, /<tool_call>|Generating now/);
  assert.match(JSON.stringify(session.messages.at(-1)), /Brief saved/);
  assert.equal(generationCount(), 0);
  assert.equal(session.messages.length, 2);
  assert.ok(session.brief);
  assert.equal(session.brief.approvedAt, undefined);
  assert.equal(session.brief.saleId, null);
  assert.equal(session.brief.parentVariantId, null);
  assert.equal(model.doStreamCalls.length, 2);
  const deniedModel = new MockLanguageModelV4({ doStream: [
    toolStep("generateAd", {}, "unapproved-generate"),
    textStep("<tool_call>approveBrief</tool_call>"),
  ] });
  const deniedAgent = createConcierge(workflow, deniedModel);
  const deniedResponse = await createAgentUIStreamResponse({ agent: deniedAgent, experimental_transform: conciergeText(deniedAgent.responseText), uiMessages: [{ id: "denied", role: "user", parts: [{ type: "text", text: "Generate the revised ad" }] }] });
  const deniedStream = await deniedResponse.text();
  assert.match(deniedStream, /Approve the current brief/);
  assert.doesNotMatch(deniedStream, /<tool_call>/);
  assert.equal(deniedModel.doStreamCalls.length, 1);
  assert.equal(session.brief.approvedAt, undefined);
  assert.equal(generationCount(), 0);
  await workflow.approveBrief(session.brief.id);
  session.messages.push({ id: "user2", role: "user", parts: [{ type: "text", text: "Generate the approved brief" }] });
  const resumed = new MockLanguageModelV4({ doStream: [toolStep("generateAd", {}, "generate1"), textStep("Your reviewed image is ready.")] });
  const resumedAgent = createConcierge(workflow, resumed);
  const result = await createAgentUIStreamResponse({ agent: resumedAgent, experimental_transform: conciergeText(resumedAgent.responseText), uiMessages: session.messages, generateMessageId: randomUUID, onEnd: ({ messages }) => { session.messages = messages; } });
  assert.match(await result.text(), /reviewed image is ready/);
  assert.equal(generationCount(), 1);
  assert.equal(session.variants[0].status, "reviewed");
  assert.equal(session.messages.length, 4);
  const failed = new MockLanguageModelV4({ doStream: [
    toolStep("prepareBrief", { ...brief, saleId: "invented" }, "invalid-brief"),
    textStep("The sale is not supported. Please choose another offer."),
  ] });
  const failedAgent = createConcierge(workflow, failed);
  const failure = await createAgentUIStreamResponse({ agent: failedAgent, experimental_transform: conciergeText(failedAgent.responseText), uiMessages: [{ id: "user3", role: "user", parts: [{ type: "text", text: "Use an invented sale" }] }] });
  assert.match(await failure.text(), /This offer is stale or its eligibility is unresolved/);
  assert.equal(failed.doStreamCalls.length, 1);
  assert.equal(generationCount(), 1);
});

test("printed tool tags across text chunks are not executed, displayed, or saved", async () => {
  const { createAgentUIStreamResponse, simulateReadableStream } = await import("ai");
  const { MockLanguageModelV4 } = await import("ai/test");
  const { createConcierge } = await import("../lib/workflow/agents/concierge");
  const { workflow, session, generationCount } = fixture();
  await draft(workflow);
  const model = new MockLanguageModelV4({ doStream: {
    stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "Generating now. <tool_" },
      { type: "text-delta", id: "text", delta: "call>approveBrief</tool_call>" },
      { type: "text-end", id: "text" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } },
    ] }),
  } });
  const agent = createConcierge(workflow, model);
  const response = await createAgentUIStreamResponse({ agent, experimental_transform: conciergeText(agent.responseText), uiMessages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Generate" }] }], onEnd: ({ messages }) => { session.messages = messages; } });
  const stream = await response.text();
  assert.doesNotMatch(stream, /<tool_|Generating now|tool-input-available/);
  assert.match(stream, /did not execute an action/);
  assert.match(JSON.stringify(session.messages), /Approve brief and photo/);
  assert.doesNotMatch(JSON.stringify(session.messages), /<tool_/);
  assert.equal(session.brief!.approvedAt, undefined);
  assert.equal(generationCount(), 0);
});

test("research accepts missing or blank optional URLs and Markdown links but rejects malformed URLs", () => {
  for (const optional of [undefined, null, "", "  "]) {
    assert.deepEqual(researchInputSchema.parse({ url: `[Loopy](https://www.loopycases.com)`, productUrl: optional, campaignUrl: optional }), {
      url: "https://www.loopycases.com", productUrl: null, campaignUrl: null,
    });
  }
  assert.equal(researchInputSchema.safeParse({ url: "not a URL" }).success, false);
  assert.equal(researchInputSchema.safeParse({ url: source.url, productUrl: "bad URL" }).success, false);
  assert.equal(researchInputSchema.parse({ url: "www.loopycases.com" }).url, "https://www.loopycases.com");
  assert.equal(researchInputSchema.parse({ url: "loopycases.com/products/cheetah" }).url, "https://loopycases.com/products/cheetah");
  assert.equal(researchInputSchema.parse({ url: "[Loopy](www.loopycases.com)" }).url, "https://www.loopycases.com");
  assert.equal(researchInputSchema.safeParse({ url: "ftp://loopycases.com" }).success, false);
});

test("legacy tool errors migrate to input without losing error history or overwriting existing input", () => {
  const legacy = [{ id: "assistant1", role: "assistant", parts: [
    { type: "tool-research", toolCallId: "call1", state: "output-error", rawInput: { url: source.url, productUrl: "" }, errorText: "Failed input" },
    { type: "tool-research", toolCallId: "call2", state: "output-error", input: { url: source.url }, rawInput: { url: "obsolete" }, errorText: "Failed input" },
  ] }] as unknown as UIMessage[];
  const migrated = normalizeMessages(legacy);
  assert.doesNotMatch(JSON.stringify(migrated), /rawInput/);
  assert.deepEqual((migrated[0].parts[0] as { input: unknown }).input, { url: source.url, productUrl: "" });
  assert.deepEqual((migrated[0].parts[1] as { input: unknown }).input, { url: source.url });
  assert.match(JSON.stringify(legacy), /rawInput/);
  assert.match(JSON.stringify(migrated), /Failed input/);
});

test("tool-input failures are distinguished from provider failures without exposing raw input", async () => {
  const { InvalidToolInputError } = await import("ai");
  const error = new InvalidToolInputError({ toolName: "research", toolInput: "sensitive input", cause: new Error("invalid URL") });
  assert.match(safeError(error), /Invalid input for research/);
  assert.doesNotMatch(safeError(error), /sensitive|Provider request failed/);
});

test("structured findings use function tools instead of provider JSON-schema formatting", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const findings = { voice: "Friendly", audience: "Phone owners", sales: [] };
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "tool-call", toolCallId: "result1", toolName: "submitResult", input: JSON.stringify(findings) }],
    finishReason: { unified: "tool-calls", raw: undefined }, warnings: [],
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
  } });
  assert.deepEqual(await structuredResult({ model, schema: findingsSchema, instructions: "Return findings.", messages: [{ role: "user", content: "A friendly phone store." }] }), findings);
  assert.notEqual(model.doGenerateCalls[0].responseFormat?.type, "json");
  assert.deepEqual(model.doGenerateCalls[0].toolChoice, { type: "tool", toolName: "submitResult" });
});
