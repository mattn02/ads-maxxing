/** Actual onboarding transactions in isolated Postgres; no remote services or paid calls. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
if (!process.env.PGLITE_MODULE)
  throw new Error("Set PGLITE_MODULE to @electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(bucket_id text,name text); create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$; grant usage on schema public,auth to authenticated;`,
);
const migrations = new URL("../supabase/migrations/", import.meta.url);
for (const file of (await readdir(migrations))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(new URL(file, migrations), "utf8"));
const call = async (name, args) =>
  (
    await db.query(
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
      args,
    )
  ).rows[0].result;
const owner = randomUUID(),
  other = randomUUID(),
  key = randomUUID();
await db.query("insert into auth.users values($1),($2)", [owner, other]);
const args = [
  owner,
  key,
  "loopycases.com",
  "https://www.loopycases.com/",
  "https://www.loopycases.com/products/case",
];
const setup = await call("create_brand_setup", args);
assert.equal(await call("create_brand_setup", args), setup);
assert.equal(
  await call("create_brand_setup", [owner, randomUUID(), ...args.slice(2)]),
  setup,
);
const brandId = (
  await db.query("select brand_id from campaigns where id=$1", [setup])
).rows[0].brand_id;
const readBrand = async () =>
  (await db.query("select * from brands where id=$1", [brandId])).rows[0];
const source = {
  url: args[3],
  title: "Loopy",
  markdown: "Real store",
  images: [],
  fetchedAt: new Date().toISOString(),
  description: "Useful cases",
  colors: {},
};
const research = {
  id: randomUUID(),
  sources: [source],
  colors: [],
  voice: "Friendly",
  audience: "People",
  sales: [],
  warnings: [],
  brandKit: { name: "Loopy", overrides: {} },
};
const session = {
  id: setup,
  purpose: "brand_setup",
  setup: { state: "researching", storeUrl: args[3], operationId: randomUUID() },
  messages: [],
  events: [],
  preferences: {},
  variants: [],
  research,
};
let lease = await call("claim_campaign", [owner, setup]);
const save = async () => {
  const result = await call("commit_campaign", [
    owner,
    setup,
    lease.token,
    lease.revision,
    session,
    args[2],
    2,
  ]);
  lease.revision = result.revision;
  return result;
};
await save();
assert.equal(
  (await readBrand()).completed_context_id,
  null,
  "Checkpoint is never canonical",
);
await assert.rejects(call("claim_campaign", [owner, setup]), /busy/);
await assert.rejects(
  call("start_brand_campaign", [
    owner,
    brandId,
    randomUUID(),
    setup,
    research.id,
    { ...research, id: randomUUID() },
    { role: "assistant" },
  ]),
  /Finish brand setup/,
);
session.setup.state = "ready";
session.research = { ...research, id: randomUUID() };
await save();
const contextId = session.research.id;
assert.equal((await readBrand()).completed_context_id, contextId);
await call("release_campaign", [owner, setup, lease.token]);
const message = {
  id: randomUUID(),
  role: "assistant",
  parts: [{ type: "text", text: "Choose a direction" }],
};
const startKey = randomUUID();
const firstArgs = [
  owner,
  brandId,
  startKey,
  setup,
  contextId,
  { ...research, id: randomUUID() },
  message,
];
assert.equal(await call("start_brand_campaign", firstArgs), setup);
assert.equal(await call("start_brand_campaign", firstArgs), setup);
assert.equal(
  await call("start_brand_campaign", [
    owner,
    brandId,
    startKey,
    null,
    contextId,
    { ...research, id: randomUUID() },
    message,
  ]),
  setup,
  "Network retry after promotion reuses the campaign",
);
assert.equal(
  (await db.query("select messages from campaigns where id=$1", [setup]))
    .rows[0].messages.length,
  1,
);
assert.deepEqual(
  (await db.query("select events from campaigns where id=$1", [setup])).rows[0]
    .events,
  [],
);
const corrected = {
  ...research,
  id: randomUUID(),
  brandKit: {
    name: "Loopy",
    overrides: { name: "Loopy Cases", voice: "Latest correction" },
  },
};
await call("correct_brand_context", [owner, brandId, 1, corrected]);
assert.equal((await readBrand()).name, "Loopy Cases");
await assert.rejects(
  call("correct_brand_context", [
    owner,
    brandId,
    1,
    { ...corrected, id: randomUUID() },
  ]),
  /Brand changed/,
);
await assert.rejects(
  call("correct_brand_context", [
    other,
    brandId,
    2,
    { ...corrected, id: randomUUID() },
  ]),
  /Finish brand setup/,
);
await assert.rejects(
  call("start_brand_campaign", [
    owner,
    brandId,
    randomUUID(),
    null,
    contextId,
    { ...research, id: randomUUID() },
    message,
  ]),
  /Brand changed/,
);
// An older campaign writing a NEW research snapshot still cannot change shared context.
lease = await call("claim_campaign", [owner, setup]);
session.purpose = "campaign";
session.research = { ...research, id: randomUUID() };
session.setup.state = "ready";
await save();
assert.equal((await readBrand()).completed_context_id, corrected.id);
assert.equal(
  (await readBrand()).brand_kit.overrides.voice,
  "Latest correction",
);
const nextKey = randomUUID();
const nextArgs = [
  owner,
  brandId,
  nextKey,
  null,
  corrected.id,
  { ...corrected, id: randomUUID() },
  message,
];
const second = await call("start_brand_campaign", nextArgs);
assert.equal(await call("start_brand_campaign", nextArgs), second);
assert.notEqual(second, setup);
const secondRow = (
  await db.query("select * from campaigns where id=$1", [second])
).rows[0];
assert.deepEqual(secondRow.preferences, {});
assert.equal(secondRow.current_version_id, null);
assert.equal(secondRow.messages.length, 1);
await assert.rejects(
  call("start_brand_campaign", [
    other,
    brandId,
    randomUUID(),
    null,
    corrected.id,
    { ...corrected, id: randomUUID() },
    message,
  ]),
  /Finish brand setup/,
);
assert.equal(
  await call("create_brand_setup", [owner, randomUUID(), ...args.slice(2)]),
  setup,
  "Existing ready URL reuses saved brand",
);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
await db.exec("set role authenticated");
assert.equal((await db.query("select * from brands")).rows.length, 0);
for (const name of [
  "create_brand_setup",
  "start_brand_campaign",
  "correct_brand_context",
]) {
  const parameters =
    name === "create_brand_setup"
      ? args
      : name === "start_brand_campaign"
        ? nextArgs
        : [owner, brandId, 2, corrected];
  await assert.rejects(call(name, parameters), /permission denied/);
}
await db.exec("reset role");
await db.close();
console.log(
  "PASS: all migrations, setup deduplication, checkpoint gating, leases, atomic promotion/opening, retry after promotion, canonical context, revision conflicts, stale campaign isolation, new campaign idempotency, owner isolation and RPC permissions.",
);
