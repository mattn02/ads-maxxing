/** Actual SQL acceptance guards in isolated Postgres; no hosted writes or providers. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to @electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema public,auth to authenticated;`);
const directory = new URL("../supabase/migrations/", import.meta.url);
const migrationName = "202609220005_review_acceptance.sql";
for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql") && name < migrationName).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
const call = async (name, args) => (await db.query(`select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`, args)).rows[0].result;
const owner = randomUUID(), other = randomUUID(), campaign = randomUUID(), source = randomUUID(), version = randomUUID();
await db.query("insert into auth.users values($1),($2)", [owner, other]);
await call("create_campaign", [owner, campaign]);
const lease = await call("claim_campaign", [owner, campaign]);
const research = { id: randomUUID(), sources: [{ url: "https://www.loopycases.com/", title: "Loopy", markdown: "Cases", images: [] }], sales: [] };
const session = { id: campaign, messages: [], events: [], preferences: {}, variants: [], research };
let rpc = "commit_campaign";
const save = async () => {
  const payload = rpc === "commit_campaign_v2" ? { ...session, researchReference: { id: research.id, schemaVersion: 1 } } : session;
  if (rpc === "commit_campaign_v2") delete payload.research;
  const result = await call(rpc, [owner, campaign, lease.token, lease.revision, payload, "loopycases.com", 1]);
  lease.revision = result.revision;
  return result;
};
const initial = await save();
for (const [id, kind] of [[source, "product_photo"], [version, "composed_ad"]]) {
  lease.revision = (await call("register_asset", [owner, campaign, lease.token, lease.revision, { id, kind, storage_path: `${owner}/${initial.brand_id}/${id}/image.png`, source_research_id: research.id, storage_state: "ready", content_hash: "fixture", byte_size: 100, mime_type: "image/png", width: 576, height: 1024, metadata: kind === "composed_ad" ? { versionId: version } : {} }])).revision;
}
session.brief = { id: version, researchId: research.id, sourceAssetId: source, headline: "Hold on to color", cta: "Shop now", approvedAt: new Date().toISOString() };
await save();
const variant = { id: version, imageUrl: `/api/outputs/${version}`, brief: structuredClone(session.brief), research, status: "approved", review: { verdict: "pass" } };
session.variants = [variant];
await save(); // Existing legacy approval is established using the predecessor's rules.
const read = async () => (await db.query("select generation,approved_at,review_status,final_asset_id from ad_versions where id=$1", [version])).rows[0];
const legacyApprovedAt = (await read()).approved_at;
const migration = await readFile(new URL(migrationName, directory), "utf8");
await db.exec(migration);
if (process.env.TEST_RESEARCH_REFERENCE === "1") {
  await db.exec(await readFile(new URL("202609220006_research_reference.sql", directory), "utf8"));
  rpc = "commit_campaign_v2";
}
await save();
assert.equal((await read()).approved_at.toISOString(), legacyApprovedAt.toISOString());
assert.equal((await read()).generation.review.verdict, "pass");
assert.equal((await read()).generation.acceptance, undefined);

const review = (verdict = "needs_human", checks = [{ name: "portrait_9_16", passed: true, detail: "576x1024" }]) => ({ verdict, checks, createdAt: "2026-09-22T06:00:00.000Z", visual: { summary: "Human should inspect product details" } });
const acceptance = () => ({ acceptedAt: "2026-09-22T06:05:00.000Z", reviewedAt: variant.review.createdAt });
variant.status = "needs_human"; variant.review = review(); await save();
assert.equal((await read()).approved_at, null);
variant.status = "approved";
await assert.rejects(save(), /Acceptance must identify/);
variant.acceptance = acceptance(); await save();
assert.equal((await read()).generation.review.verdict, "needs_human", "Human acceptance never rewrites machine verdict");
assert.deepEqual((await read()).generation.acceptance, acceptance());
assert.equal((await read()).approved_at.toISOString(), variant.acceptance.acceptedAt);
await save();
assert.equal((await read()).approved_at.toISOString(), variant.acceptance.acceptedAt, "Later saves retain original acceptance time");
variant.acceptance.acceptedAt = "2026-09-22T06:06:00.000Z";
await assert.rejects(save(), /timestamp cannot be changed/);
variant.acceptance = acceptance();
variant.status = "pending_review";
await assert.rejects(save(), /Clear acceptance/);
delete variant.acceptance; delete variant.review; await save();
assert.equal((await read()).approved_at, null);
assert.equal((await read()).generation.acceptance, undefined);
assert.equal((await read()).review_status, "pending_review");
assert.equal((await read()).final_asset_id, version);

for (const [status, output, expected] of [
  ["needs_human", review("needs_human", [{ name: "source_photo", passed: false }]), /passing deterministic/],
  ["needs_human", review("needs_human", []), /passing deterministic/],
  ["needs_human", review("needs_human", [{ name: "source_photo", passed: "true" }]), /passing deterministic/],
  ["needs_human", review("needs_changes"), /Failed reviews/],
  ["review_failed", review(), /completed review/],
  ["pending_review", review(), /completed review/],
  ["review_failed", undefined, /completed review/],
]) {
  variant.status = status; variant.review = output; delete variant.acceptance; await save();
  variant.status = "approved"; variant.acceptance = { acceptedAt: "2026-09-22T06:05:00.000Z", reviewedAt: output?.createdAt };
  await assert.rejects(save(), expected);
}
variant.status = "needs_human"; variant.review = review(); delete variant.acceptance; await save();
variant.status = "approved"; variant.acceptance = acceptance(); variant.review.verdict = "pass";
await assert.rejects(save(), /acceptance cannot change its review/);
variant.review = review(); variant.acceptance.reviewedAt = "2026-09-21T06:00:00.000Z";
await assert.rejects(save(), /current saved review/);
variant.acceptance = acceptance(); await save();
delete variant.acceptance;
await assert.rejects(save(), /Acceptance must identify/, "New acceptance cannot silently become a legacy approval");
variant.acceptance = acceptance();
variant.imageUrl = "/changed.png";
await assert.rejects(save(), /creative content is immutable/);
variant.imageUrl = `/api/outputs/${version}`;
variant.status = "reviewed"; variant.review = review("pass"); delete variant.acceptance; await save();
variant.status = "approved"; variant.acceptance = acceptance(); await save();
assert.equal((await read()).generation.review.verdict, "pass");
await assert.rejects(call(rpc, [other, campaign, lease.token, lease.revision, session, "loopycases.com", 1]), /lease expired/);
await db.exec("set role authenticated");
await assert.rejects(call(rpc, [owner, campaign, lease.token, lease.revision, session, "loopycases.com", 1]), /permission denied/);
await db.exec("reset role");
await assert.rejects(db.exec(migration), /Unexpected commit_campaign definition/, "Guarded patch rejects unexpected or already-patched predecessor");
await db.exec("rollback");
await db.close();
console.log("PASS: legacy approvals, uncertain acceptance, strict deterministic checks, durable unchanged review, acceptance timestamps, re-review revocation, immutable final content, owner isolation and RPC grants.");
