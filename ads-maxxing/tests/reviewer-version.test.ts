import assert from "node:assert/strict";
import { test } from "node:test";
import { codeChecks, reviewAd, reviewVerdict } from "../lib/workflow/agents/reviewer";
import { persistenceContext } from "../lib/supabase/server";
import type { Variant } from "../lib/workflow/session-types";

const id = "00000000-0000-4000-8000-000000000001";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=", "base64");
const variant = (rendererVersion: number) => ({ id, rendererVersion, brief: { id, researchId: id }, research: { id, sales: [], sources: [] } }) as unknown as Variant;

test("review accepts renderer 2 and 3 and unknown versions cannot pass", () => {
  const pass = { status: "pass" as const, reason: "Visible" };
  for (const version of [1, 2, 3, 4, 999]) {
    const check = codeChecks(variant(version), png).find(check => check.name === "renderer_version")!;
    assert.equal(check.passed, version === 2 || version === 3);
    assert.equal(reviewVerdict([check], { productFidelity: pass, textLegibility: pass, claimAccuracy: pass, brandFit: pass, summary: "Visible" }), check.passed ? "pass" : "needs_changes");
  }
});

test("both supported renderers refuse fidelity review without the saved original before calling a model", async t => {
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY"] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.SUPABASE_URL = "https://storage.example";
  process.env.SUPABASE_ANON_KEY = "test";
  process.env.SUPABASE_SECRET_KEY = "test";
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    reads++;
    const url = String(input);
    if (url.includes("/rest/v1/ad_versions?")) return Response.json([{ final_asset_id: id }]);
    if (url.includes("/rest/v1/assets?")) return Response.json([{ id, storage_state: "ready", bucket: "creative-assets", storage_path: "final.png" }]);
    if (url.includes("/storage/v1/object/")) return new Response(new Uint8Array(png));
    assert.fail("Review must not contact the model or a remote product photo without the saved original");
  });
  try {
    for (const version of [2, 3]) await persistenceContext.run({ userId: id }, async () => {
      await assert.rejects(reviewAd(variant(version)), /Saved original is missing; fidelity review cannot run/);
    });
    assert.equal(reads, 6);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
