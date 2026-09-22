# Finished-ad acceptance

`Variant.status = "approved"` records the user's acceptance. Machine review remains separate: `review.verdict` is never changed by acceptance. New decisions include `acceptance: { acceptedAt, reviewedAt }`, where `reviewedAt` identifies the current saved `review.createdAt`.

Migration `202609220005_review_acceptance.sql` narrowly patches `commit_campaign` after migration 004. It verifies the expected predecessor text before replacing it and refuses unexpected or already-patched definitions. Apply once in migration order. Function privileges, owner/lease checks, immutable final content, asset references and paid-attempt guards remain unchanged.

New acceptance requires an already saved review and a prior finished review status (`reviewed`, `needs_human`, or an existing `approved`). Its verdict must be `pass` or `needs_human`; deterministic `review.checks` must be a nonempty array with every `passed` value equal to JSON boolean `true`. Acceptance cannot rewrite the saved review or approve a pending/failed/missing review. `needs_changes` remains blocked even if the checks pass.

Re-review must remove acceptance and move the variant out of `approved`; the existing upsert clears `approved_at`. A subsequent review can receive a new human decision. Repeated saves retain the original acceptance timestamp, and an existing decision's timestamp cannot be changed in place. Previously approved legacy `pass` records with no acceptance object remain saveable only with their unchanged saved review; no synthetic acceptance is backfilled.

Run the actual SQL guards locally, without providers or hosted database writes:

```sh
PGLITE_MODULE=/tmp/ads-persistence-sql-validation/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-review-acceptance-sql.mjs
```

The harness applies migrations 001–004, creates a legacy approval, applies 005, and verifies uncertain acceptance, hard/empty/malformed checks, pass acceptance, unchanged verdicts, review timestamps, re-review revocation, immutable creative content, owner isolation and RPC permissions. It also verifies that the guarded migration refuses an unexpected predecessor. Hosted application is a separate step; this test does not claim to verify hosted Auth or Storage.
