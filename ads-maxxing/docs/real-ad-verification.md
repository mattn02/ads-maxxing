# Real ad verification — 2026-09-22

This is an engineering verification record, not the applicant-authored product note.

The real saved Loopy campaign `df887c12-623e-45b5-8664-49d6fd4cbef2` was already at `ready_for_brief` despite the reported photo-classification warning. Its selected product was Berry Pink. The verification copied its immutable observed research into a separate, labeled campaign under the same owner; the source campaign was not changed.

- Verification campaign: `bc88ba48-ae6b-48f0-b0c4-c8b1a2ed57dc`.
- Pinned original asset: `7133cd1d-02d4-4bec-8acb-181c4ecfe633`.
- Initial output: `8dc89ae9-f4a9-4ab9-bcab-c0f7918ba671`.
- Corrected output: `4d14c9e6-47ad-4246-b66b-fef2a6d1d606`.
- Corrected output route: `/api/outputs/4d14c9e6-47ad-4246-b66b-fef2a6d1d606`.
- Image calls: exactly one fal background and one fal scene. Recomposition reused both saved stages, with no further image calls.

The corrected 576 × 1024 PNG, original, background, and scene are all ready in private Supabase Storage. Production `loadSession` and `readImage` reload the output and its original-source provenance. Local visual-QA artifacts are under ignored `local-output/real-ad-verification/`; the report has IDs, public original provenance, review and asset hashes, without credentials or provider recovery URLs.

The real AI Gateway review returned `needs_human`, with all 11 deterministic checks passing. Text, claims and brand fit passed. Product fidelity was uncertain because the generated loop and its embossed detail are faint and the product is smaller. The ad was **not** approved. Visual inspection confirmed the full product and camera openings remain visible in the corrected output.

## Demonstrated blockers and bounded changes

1. `commit_campaign` returned PostgreSQL `57014` (statement timeout). The original session serialized to 11.06 MB because each variant repeated the 5.52 MB immutable research snapshot. `saveSession` now omits the historical `variant.research` from the RPC payload; `brief.researchId` already points to the snapshot, and loading hydrates it as before. The full historical research remains in memory and storage. Ten subsequent production saves succeeded with 5.54–5.56 MB payloads and measured HTTP latency of 3.77–8.72 seconds. The reduction is verified; hosted latency and the full cause of the timeouts remain unresolved. No database timeouts, immutability checks, or ownership guards were relaxed.
2. The scene provider ignored the requested empty copy area. The old full-canvas scene was covered by the opaque headline panel, hiding the case's top. Renderer version 3 contains the entire portrait scene inside the visual slot. Design version 2 and generation fingerprints remain unchanged, allowing the saved image stages to be reused. The original final remains immutable; a new revision contains the corrected output. This trades product size for guaranteed visibility, and further visual polish remains necessary.

The test exercised production workflow methods, real providers, owner-scoped persistence, guarded leases, immutable checkpoints, and a real review. It did not prove the authenticated browser path: the available Safari cookie identity differed from the source campaign's owner. Browser onboarding-to-generation remains a separate verification gate.

## Repeating a bounded check

`scripts/verify-real-ad.ts` takes a source campaign with a selected observed public Loopy product/photo. It does not invent a product, replace review results, or reset a paid attempt.

```sh
node --env-file=.env.local --import tsx scripts/verify-real-ad.ts prepare local-output/new-verification <source-campaign-id>
# Inspect the saved original before the explicit bounded generation step.
node --env-file=.env.local --import tsx scripts/verify-real-ad.ts generate local-output/new-verification --allow-two-paid-calls
node --env-file=.env.local --import tsx scripts/verify-real-ad.ts verify local-output/new-verification
```

The run ledger and production checkpoints cap generation at one call per stage. A fresh request may continue only saved or previously unattempted stages; an unknown attempted stage cannot be resubmitted. `recompose` creates a new revision reusing both saved stages and rejects any fal submission; `review` performs only review of the recorded completed variant. Both retain real review results. The script requires explicitly authorized live service access and never prints credentials or signed provider URLs.
