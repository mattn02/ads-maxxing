# Saved research references

Apply `supabase/migrations/202609220006_research_reference.sql` after migrations 001–005. It adds `commit_campaign_v2` with the same arguments as `commit_campaign`; the old RPC remains unchanged for existing clients. The application requires 006 and does not fall back to the old RPC when it is missing.

For a previously loaded or successfully saved, unchanged research snapshot, the client sends `researchReference: { id, schemaVersion }` and omits the `research` key entirely. The service validates the owner, campaign brand and schema against the stored snapshot, loads its canonical data for campaign metadata, and skips re-inserting or comparing the full research JSON. New or changed research still takes the original full snapshot path; changing content under an existing ID remains forbidden. Sending both keys, including `research: null`, is rejected.

Only `service_role` can execute the new RPC. Lease checks, paid-attempt guards, asset ownership, immutable creative content and migration 005's human acceptance rules are unchanged. The migration fails closed when its expected predecessor differs or v2 already exists. No database timeout settings, automatic retries or hosted data updates are introduced.

The purpose is to remove repeated multi-megabyte research payloads from routine campaign progress saves. This is an evidenced payload optimization, not proof that it resolves every possible hosted statement timeout.

Local SQL verification uses isolated PGlite with minimal Supabase schema stubs:

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/verify-research-reference-sql.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js TEST_RESEARCH_REFERENCE=1 node scripts/verify-review-acceptance-sql.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/verify-persistence-sql.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/verify-onboarding-sql.mjs
```

The reference suite tests owner/brand/schema isolation, malformed and mixed payloads, snapshot preservation and refresh, old-RPC preservation, service-only privileges, and migration predecessor/reapply guards. It compares all SQL after the research branch byte-for-byte with the existing RPC. The acceptance suite runs its full legacy/pass/uncertain/failed/hard-check/re-review/immutability matrix through the new reference path when the environment flag is set.
