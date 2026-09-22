# Durable workflow setup and recovery

The production app uses Supabase only. Missing configuration returns an actionable setup error; it never falls back to local files. Five application tables separate owner-specific brands, immutable research snapshots, campaigns, ad versions and assets. Brief/design/copy and fixed execution checkpoints are validated JSONB in `ad_versions`, with explicit owner/campaign/research/parent/source/background/scene/final foreign keys. This keeps the evolving creative contract together rather than duplicating every creative field into scalar columns.

Set the server environment (local `.env.local` and Vercel):

```text
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and legacy `SUPABASE_SERVICE_ROLE_KEY` are supported aliases. Never prefix the secret with `NEXT_PUBLIC_`. JWKS configuration is unnecessary: each request verifies the access token against `/auth/v1/user`. Access/refresh tokens use HttpOnly, SameSite=Lax cookies (Secure on HTTPS). Mutations reject foreign Origin headers. Refresh failure retains the old identity rather than silently replacing saved work with another account.

Apply both files in `supabase/migrations/` in filename order using the project's SQL editor or `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f PATH_TO_MIGRATION`. The second migration prevents old campaign saves from overwriting newer shared brand corrections. Enable anonymous sign-ins under Authentication → Sign In / Providers. The private `creative-assets` bucket is created by the migration. Anonymous accounts are distinct authenticated users; clearing browser cookies loses access unless an account is linked separately. The initial workspace API request establishes identity before loading data.

All mutations go through server-only RPCs; browser roles have read-only owner RLS. Server-privileged queries still filter verified owner IDs. Each campaign claim lasts six minutes for five-minute routes. Every save and asset registration checks owner/token/revision/expiry and advances the revision. Chat retains the claim through tool completion and final message persistence, including browser disconnects. Changes to any research or preferences require fresh pending-brief approval; finished ads retain original evidence and approvals.

A source must be observed in saved research, then captured to private Storage before approval. Downloads pin a public DNS result, validate every redirect, enforce time/byte/pixel limits and sniff raster headers. Original source bytes are retained exactly; this release does not normalize EXIF orientation or color profiles. Approved source identity is an asset ID, never a signed URL. Provider access receives a fresh ten-minute URL. Final output URLs are authenticated `/api/outputs/:versionId` routes; source previews use `/api/assets/:assetId`.

Background and scene have independent attempt/result/saved checkpoints. The attempted marker is committed before each paid call, and the provider result before download. Unknown attempts cannot be resubmitted automatically. Recovery downloads the same saved provider output or reuses a saved stage. Ready object paths are immutable. An upload interrupted before registration is verified by hash before finishing registration. Generated scenes are normalized proportionally, without cropping, to the saved 576 × 1024 PNG; backgrounds must already match the renderer geometry. Composition and review retries do not repeat successful paid stages. Review runs only after the final durable record exists.

## Verification

Unit checks use `npm test`. The actual migration can also execute in isolated Postgres through PGlite without contacting Supabase:

```sh
npm install --prefix /tmp/creative-sql-check @electric-sql/pglite --no-audit --no-fund
PGLITE_MODULE=/tmp/creative-sql-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-persistence-sql.mjs
```

This verifies SQL syntax, RLS/grants, owner separation, immutability, concurrent claims, stale writers and paid-attempt guards. Its minimal `auth`/`storage` schema stubs do not verify the hosted Auth or Storage services. Run the explicit live harness after provisioning:

```sh
node --env-file=.env.local --import tsx scripts/verify-supabase-live.ts
node --env-file=.env.local scripts/verify-import-live.mjs
```

It creates two disposable anonymous test identities and test campaigns, verifies private bytes/signed URLs, reloads sessions and checks direct client denial. It leaves test records for inspection; no destructive cleanup occurs automatically.

## Importing local demos

Default dry run reads source files only:

```sh
node --import tsx scripts/import-local.ts --owner DESTINATION_USER_UUID --directory /absolute/local-output
node --env-file=.env.local --import tsx scripts/import-local.ts --owner DESTINATION_USER_UUID --directory /absolute/local-output --apply
```

Use an existing verified destination owner. Different brand histories split into deterministic campaign IDs. Existing consistent IDs and immutable snapshots are retained; missing images or conflicts are reported. Source files are never edited and no providers are called. Re-running a completed import skips its existing records. Interrupted partially populated imports report a conflict for inspection rather than overwriting newer work. Legacy final ads remain viewable without claiming their remote product photo is the original input. Old visual components are not promoted as reusable two-stage assets. Ungenerated legacy drafts lose approval, retaining any ambiguous attempt marker.

## Operational limits

A claim cannot make an external billable API exactly-once. If a worker loses its lease after a provider call but before recording the result, operator recovery may be needed. Expired provider output URLs cannot be regenerated implicitly: create and explicitly approve a new version. There is no general job queue, cross-user cache, automatic provider retry, destructive asset cleanup or cross-device anonymous account recovery.

## Verification performed during implementation

On September 22, 2026, the migration and anonymous sign-in were applied to the configured Supabase project. Live checks passed for two identities researching the same host, private uploads/downloads, refreshed signed URLs, campaign reloads, final image/review/approval, old approval retention after research edits, and denied cross-owner reads/direct client writes/RPCs. Synthetic mixed-brand legacy data passed a dry run plus two import passes without changing source files. These harnesses made zero paid provider calls. The isolated SQL harness additionally covers lease expiry/stale writers, stage-attempt reset rejection, immutable research/content/assets and reused stage foreign keys. Deployed Vercel verification is separate.
