import assert from "node:assert/strict";
import test from "node:test";
import { campaignProgress } from "../lib/workspace/progress";
import type { Session } from "../lib/workflow/session-types";

const authorizedAt = "2026-09-22T12:00:00.000Z";
function fixture(overrides: Partial<Session> = {}): Session {
  return {
    id: "campaign", createdAt: authorizedAt, updatedAt: authorizedAt,
    messages: [], preferences: {}, variants: [], events: [],
    researchState: { stage: "campaign_researching", generationIntent: { requestId: "current", source: { direction: "New ad" }, authorizedAt } },
    ...overrides,
  } as Session;
}
function statuses(session: Session, busy = true) {
  return campaignProgress(session, busy, "").steps.map(step => step.status);
}

test("an older variant and event cannot complete or narrate the current request", () => {
  const session = fixture({
    variants: [{ id: "older", brief: { id: "older" } }] as Session["variants"],
    events: [{ at: "2026-09-21T12:00:00.000Z", action: "generate", status: "completed" }],
  });
  assert.deepEqual(statuses(session), ["current", "pending", "pending", "pending"]);
  assert.equal(campaignProgress(session, true, "").currentEvents.length, 0);
});

test("a saved scene completes image work but keeps review current", () => {
  const session = fixture({
    researchState: { stage: "ready_for_brief", generationIntent: { requestId: "current", source: { direction: "New ad" }, authorizedAt, researchId: "research", briefId: "brief" } },
    brief: { id: "brief", sourceAssetId: "pinned", referenceImage: "https://example.com/photo.jpg", sceneCheckpoint: { state: "saved" } } as Session["brief"],
  });
  assert.deepEqual(statuses(session), ["complete", "complete", "complete", "current"]);
  assert.equal(campaignProgress(session, true, "").productImage?.src, "/api/assets/pinned");
});

test("needs input stays paused and retry becomes active only while work resumes", () => {
  const session = fixture({ nextAction: { kind: "needs_input", requestId: "current" } });
  assert.equal(campaignProgress(session, true, "").state, "needs_input");
  session.nextAction = { kind: "retry", requestId: "current", duplicateRisk: true };
  assert.equal(campaignProgress(session, false, "").state, "retry");
  assert.equal(campaignProgress(session, true, "").state, "active");
});

test("only the exact chosen eligible source image appears before a brief", () => {
  const session = fixture({
    researchState: { stage: "ready_for_brief", generationIntent: { requestId: "current", source: { direction: "New ad" }, authorizedAt, researchId: "research", setup: { referenceAssetId: "chosen", saleId: null } } },
    research: {
      id: "research", campaign: { selectedProductId: "product" },
      products: [{ id: "product", title: "Case", assetIds: ["other", "chosen"] }],
      assets: [
        { id: "other", originalUrl: "https://example.com/other.jpg", eligibleAsProductReference: true },
        { id: "chosen", originalUrl: "https://example.com/chosen.jpg", eligibleAsProductReference: true },
      ],
    } as Session["research"],
  });
  assert.equal(campaignProgress(session, true, "").productImage?.src, "https://example.com/chosen.jpg");
  session.researchState!.generationIntent!.setup!.referenceAssetId = "missing";
  assert.equal(campaignProgress(session, true, "").productImage, undefined);
});
