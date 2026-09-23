import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createAgentUIStreamResponse, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import { createConcierge } from "../lib/workflow/agents/concierge";
import { Workflow } from "../lib/workflow/service";
import type { Session, Source } from "../lib/workflow/session-types";
import { productResearch } from "./research-fixture";

for (const visual of [false, true]) test(`ad chat inherits saved identity with ${visual ? "one set of hands" : "copy-only"} edits and pauses for approval`, async () => {
  const source: Source = { url: "https://store.example/products/blue", title: "Blue case", description: "Blue", images: ["https://store.example/blue.png"], markdown: "Blue case", colors: {}, fetchedAt: new Date().toISOString() };
  const research = productResearch(source);
  const blue = research.products![0];
  const blueAsset = research.assets![0];
  const red = { ...structuredClone(blue), id: "red-product", canonicalUrl: "https://store.example/products/red", title: "Red case", assetIds: ["red-asset"] };
  const redAsset = { ...structuredClone(blueAsset), id: "red-asset", originalUrl: "https://store.example/red.png", productIds: [red.id] };
  research.products!.push(red);
  research.assets!.push(redAsset);
  research.campaign!.productIds.push(red.id);
  research.campaign!.scope = { members: [{ productId: blue.id, variantId: null }, { productId: red.id, variantId: null }], coverage: { status: "unknown", foundProductIds: [blue.id, red.id], attemptedUrls: [], failedUrls: [] } };
  const session: Session = { id: randomUUID(), purpose: "campaign", createdAt: "now", updatedAt: "now", messages: [], preferences: {}, research, variants: [], events: [] };
  let generated = 0;
  const workflow = new Workflow(session, {
    research: async () => research, save: async () => {}, readVisual: async () => null,
    pinSourceAsset: async () => "source-test", readAsset: async () => Buffer.from("source"),
    createAd: async (current, _research, execution) => { await execution!.beforeAttempt("scene"); generated++; return { id: randomUUID(), imageUrl: "/api/outputs/blue", model: "test", prompt: "", referenceImage: current.referenceImage, createdAt: "now" }; },
    reviewAd: async () => ({ verdict: "pass", checks: [], createdAt: "now", visual: { productFidelity: { status: "pass", reason: "ok" }, textLegibility: { status: "pass", reason: "ok" }, claimAccuracy: { status: "pass", reason: "ok" }, brandFit: { status: "pass", reason: "ok" }, summary: "ok" } }),
  });
  const original = await workflow.proposeBrief({ design: structuredClone(DEFAULT_DESIGN), productId: blue.id, referenceAssetId: blueAsset.id, productUrl: blue.canonicalUrl, referenceImage: blueAsset.originalUrl, headline: "Blue every day", cta: "Shop now", direction: "Calm blue scene", saleId: null, feedback: "", parentVariantId: null });
  await workflow.approveBrief(original.id);
  const target = await workflow.generate(original.id);
  assert.equal(generated, 1);
  await workflow.selectCampaignMember(red.id, null);
  assert.equal(session.research?.campaign?.selectedProductId, red.id);
  session.researchState!.generationIntent = { requestId: "completed", source: { direction: "blue" }, researchId: session.research!.id, briefId: target.id, authorizedAt: new Date().toISOString() };
  const input = { productId: red.id, productUrl: red.canonicalUrl, referenceAssetId: redAsset.id, referenceImage: redAsset.originalUrl, saleId: "wrong-offer", parentVariantId: "wrong-ad", ...(visual ? { design: { ...original.design, scene: { direction: "One person holding the case with one set of hands. No exchange or second person.", productScale: "standard" } } } : { headline: "Blue, in fewer words" }), feedback: visual ? "lets make it one set of hands" : "Shorter headline", variation: visual ? "scene" : "auto" };
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
  const model = new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ chunks: [
    { type: "stream-start" as const, warnings: [] },
    { type: "tool-call" as const, toolCallId: "revision", toolName: "prepareBrief", input: JSON.stringify(input) },
    { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
  ] }) } });
  const agent = createConcierge(workflow, model, target);
  const response = await createAgentUIStreamResponse({ agent, uiMessages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Make the headline shorter" }] }] });
  await response.text();
  assert.equal(session.research?.campaign?.selectedProductId, blue.id);
  assert.equal(session.researchState?.generationIntent, undefined);
  assert.equal(session.brief?.parentVariantId, target.id);
  assert.equal(session.brief?.productId, blue.id);
  assert.equal(session.brief?.referenceAssetId, blueAsset.id);
  assert.equal(session.brief?.saleId, original.saleId);
  assert.equal(session.brief?.approvedAt, undefined);
  assert.equal(generated, 1);
  assert.equal(session.brief?.cta, original.cta);
  assert.equal(session.brief?.direction, original.direction);
  assert.equal(session.brief?.headline, visual ? original.headline : "Blue, in fewer words");
  assert.equal(session.brief?.variation, visual ? "scene" : "auto");
  if (visual) assert.match(session.brief!.design!.scene.direction, /one set of hands/);
  else assert.deepEqual(session.brief?.design, original.design);
});
