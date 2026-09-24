import test from "node:test";
import assert from "node:assert/strict";
import { persistenceContext } from "../lib/supabase/server";
import { saveStageAsset } from "../lib/workflow/storage";

test("a ready stage recovers after a lost checkpoint despite JSONB key ordering", async t => {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = names.map(name => process.env[name]);
  names.forEach(name => { process.env[name] = name === "SUPABASE_URL" ? "https://fixture.supabase.co" : "test-key"; });
  const id = "11111111-1111-4111-8111-111111111111";
  const input = {
    id, kind: "generated_scene" as const, imageUrl: "https://fal.media/expired-provider-output.png", model: "fixture-model", prompt: "Saved scene",
    inputs: { sourceAssetId: "original", geometry: { width: 576, height: 1024 }, references: ["original", "background"], fingerprint: "approved-fingerprint" },
  };
  // PostgreSQL jsonb returns equivalent objects with a different key order.
  const saved = {
    id, kind: input.kind, model: input.model, prompt: input.prompt, createdAt: "2026-09-22T00:00:00.000Z",
    inputs: { fingerprint: "approved-fingerprint", references: ["original", "background"], geometry: { height: 1024, width: 576 }, sourceAssetId: "original" },
  };
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    assert.match(String(url), /^https:\/\/fixture\.supabase\.co\/rest\/v1\/assets\?/);
    assert.equal(init?.method ?? "GET", "GET"); // Recovery performs no download, upload or paid request.
    reads++;
    return Response.json([{ id, kind: input.kind, storage_state: "ready", metadata: saved }]);
  });
  try {
    await persistenceContext.run({ userId: "owner" }, async () => {
      assert.deepEqual(await saveStageAsset(input), saved);
      await assert.rejects(saveStageAsset({ ...input, inputs: { ...input.inputs, sourceAssetId: "different-product" } }), /provenance/);
      await assert.rejects(saveStageAsset({ ...input, inputs: { ...input.inputs, references: ["background", "original"] } }), /provenance/);
    });
    assert.equal(reads, 3);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    t.mock.restoreAll();
  }
});
