import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { persistenceContext } from "../lib/supabase/server";
import { saveSession, loadSession } from "../lib/workflow/sessions";
import { Workflow } from "../lib/workflow/service";
import { publicSession } from "../lib/workflow/public-session";
import { productResearch } from "./research-fixture";
import type { Research, Session } from "../lib/workflow/session-types";

test("lost terminal research save reloads through the real repository as explicit retry, never automatic research", async t => {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const prior = names.map(name => process.env[name]); names.forEach(name => process.env[name] = name === "SUPABASE_URL" ? "https://project.supabase.co" : "test-key");
  const id = randomUUID(), userId = randomUUID(), brandId = randomUUID(), requestId = randomUUID();
  const source = { url: "https://shop.example/products/tote", title: "Tote", description: "Canvas tote", images: ["https://shop.example/tote.png"], markdown: "Canvas tote", fetchedAt: "now", colors: {} };
  const research = productResearch(source), absent = { status: "not_found" as const, value: null };
  research.brandKit = { id: brandId, revision: 1, canonicalStoreUrl: "https://shop.example/", name: "Shop", logoAssetIds: [], selectedLogoAssetId: null, colors: [], typography: { heading: absent, body: absent, renderFont: "geist-fallback", substitution: "Bundled" }, voice: absent, audience: absent, valueProposition: absent, overrides: {} };
  research.runs = []; research.suggestions = [];
  const initial: Session = { id, purpose: "campaign", createdAt: "now", updatedAt: "now", research, researchState: { stage: "awaiting_direction" }, messages: [], events: [], variants: [], preferences: {} };
  let durable = structuredClone(initial), revision = 0, calls = 0, loseTerminal = true;
  const snapshots = new Map<string, Research>([[research.id, research]]);
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    const target = new URL(String(url));
    if (target.pathname.endsWith("/rpc/commit_campaign_v2")) {
      const request = JSON.parse(String(init?.body));
      if (loseTerminal && request.p_session.events.some((event: Session["events"][number]) => event.action === "select_member")) return Response.json({ code: "57014", message: "statement timeout" }, { status: 500 });
      const saved = request.p_session;
      durable = structuredClone({ ...saved, research: saved.research ?? snapshots.get(saved.researchReference.id) }); snapshots.set(durable.research!.id, durable.research!);
      return Response.json({ revision: ++revision, brand_id: brandId });
    }
    if (target.pathname.endsWith("/campaigns")) return Response.json([{ id, purpose: "campaign", created_at: "now", updated_at: "now", brand_id: brandId, current_research_id: durable.research?.id, workflow_state: durable.researchState, messages: durable.messages, events: durable.events, preferences: durable.preferences, lease_expires_at: null }]);
    if (target.pathname.endsWith("/ad_versions")) return Response.json([]);
    if (target.pathname.endsWith("/research_snapshots")) return Response.json([...snapshots].map(([id, data]) => ({ id, schema_version: 2, data })));
    throw new Error("Unexpected repository request");
  });
  try {
    await persistenceContext.run({ userId, lease: { campaignId: id, token: "test-lease", revision: 0 } }, async () => {
      const workflow = new Workflow(initial, { save: saveSession, research: async () => { calls++; return { ...structuredClone(research), id: randomUUID() }; }, createAd: async () => { throw new Error("No image dispatch permitted"); }, reviewAd: async () => { throw new Error("No review permitted"); }, readVisual: async () => null });
      await assert.rejects(workflow.generateCampaign(requestId, { direction: "Promote the tote" }), /Saving this step timed out/);
      assert.equal(calls, 1); assert.equal(durable.researchState?.generationIntent?.researchId, undefined);
      const loaded = await loadSession(id);
      assert.equal(publicSession(loaded).nextAction?.kind, "retry");
      assert.equal(calls, 1, "Reload and projection never submit research");
      loaded.leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
      assert.equal(publicSession(loaded).operationActive, true);
      assert.equal(publicSession(loaded).nextAction?.kind, "continue");
      loseTerminal = false;
    });
  } finally { names.forEach((name, index) => { if (prior[index] === undefined) delete process.env[name]; else process.env[name] = prior[index]; }); t.mock.restoreAll(); }
});
