# Onboarding refactor handoff

Engineering handoff, not the applicant’s submission note.

## Scope

Implemented on `codex/onboarding-refactor`. Brand setup now runs without chat, followed by an optional editable summary. **Make creatives** starts a campaign with a saved assistant opening. New campaigns copy the selected brand’s completed context without scraping, products, preferences, briefs, or earlier conversations. Product research and the existing approval/generation/feedback workflow continue through the creative partner.

Per the product review, there is **no legacy backfill or migration heuristic**. Existing rows are retained, but only brand setups completed through the new flow establish a canonical context for new campaigns. Old blank sessions show URL onboarding. No data reset is required.

A product URL is visibly normalized to the store root during initial setup; its original URL becomes an optional first-campaign suggestion. Setup fetches the homepage and at most two company pages, retains up to 60 observed product/collection links, and skips product-photo vision. Suggestions use bounded link-based explanations. Missing optional synthesis still permits a usable summary; no useful retrieval keeps the user in recovery.

## Persistence and operations

Apply `supabase/migrations/202609220004_onboarding.sql` **after migrations 001–003**, before using this branch against Supabase. Use the project SQL editor or your normal migration process. The migration is additive and updates the campaign commit RPC; it does not delete existing data. Coordinate application rollout with the migration because shared brand edits now use their own explicit RPC.

The migration adds setup purpose/state, owner-scoped creation keys, completed brand-context pointers/revisions, and protected RPCs for setup creation, campaign start and brand correction. Partial research checkpoints never become canonical. First campaign promotion and its opening are one transaction. Revision-checked corrections preserve observed fields and store only changed overrides. Ordinary campaign saves cannot update shared brand context, even when they contain a new research snapshot.

Research executes inside the awaited route, under the existing six-minute lease and five-minute request limit. Browser polling reads saved state. Reloading never starts provider work. An interrupted operation waits for its lease to expire and requires explicit Retry. This is not a durable background job.

Onboarding deliberately has no chat hook, composer, toggle, resizing handle or raw activity log. Campaign chat mounts only after an explicit start. The URL stores selected brand/session identity; all referenced IDs are still owner-checked on the server.

Brand corrections apply to future campaigns. Existing campaigns retain their snapshot and completed variants. Adoption of updated settings into an existing campaign is deferred. Logo choices are limited to observed candidates or no logo; uploaded logos/fonts remain outside this change.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 78 tests passed, including seven new onboarding tests.
- `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/verify-onboarding-sql.mjs`: passed against isolated Postgres, executing all four actual migrations. Covers checkpoint gating, duplicate setup resolution, leases, atomic promotion, retry after promotion, a single opening, revision conflicts, stale campaign isolation, clean new campaigns, owner isolation and RPC grants.
- `npm run build -- --webpack`: passed. The default `npm run build` was attempted; Turbopack failed while binding a local subprocess port with `Operation not permitted`. The project’s default bundler was not changed to hide that environment limitation.
- Desktop and 390px mobile browser walkthrough against an isolated database and fixture providers: URL-only setup, visible product-URL normalization, research/reload, optional synthesis failure, editable summary, persisted voice/audience corrections, disabled start during edits, a concurrent stale-save conflict retaining the draft, first campaign opening, second campaign, mobile chat visibility, New brand, unsafe-URL rejection, and existing-store reuse.

The browser fixture deliberately simulated unavailable optional LLM synthesis. Campaign direction authorization and scoped research are exercised by service/research tests. Existing tests cover approval-bound generation and parent-linked feedback variants. No live fal generation, hosted database migration, deployment, or merge was performed for this refactor. A hosted Loopy Cases run through generation and feedback remains the final integration check after applying migration 004.

## Review boundaries

The working tree already contained research, diagnostics, UI and persistence-related work before this change. Those edits were preserved; this handoff is not a claim that every line in the working-tree diff originated in this refactor. The branch remains unmerged.
