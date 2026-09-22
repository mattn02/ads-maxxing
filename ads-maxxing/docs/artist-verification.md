# Artist V2 implementation verification

Engineering test record, not the assignment's author-written note.

The default artist generates an environment with `fal-ai/flux-2/klein/4b`, then integrates the saved original product and saved environment with `fal-ai/nano-banana-pro/edit`. The scene editor receives both references on every new request. Two fixed checkpoints preserve attempt timestamps and provider recovery metadata before copying bytes into Storage. An uncertain request is never automatically submitted again. A saved provider output can be copied again; saved stages can be composed again; a final ad is saved before review.

The server saves its execution plan before approval. Fingerprints include versioned prompts, model/settings, code-owned geometry, original asset identity and the exact background asset identity. They exclude copy and signed URLs. Copy/style changes with unchanged geometry reuse both images; product-pose/scale changes reuse the background; environment/template-geometry changes regenerate both. Explicit variation choices bypass the relevant reuse step. Missing reused bytes stop before spending.

`SCENE_PROMPT_VERSION=3`, `BACKGROUND_PROMPT_VERSION=2`, `SCENE_NORMALIZER_VERSION=1`, renderer version 2. Background uses four steps, one PNG, custom 576×1024. Scene uses one PNG, 9:16, 1K, `limit_generations: true`; no web search. Nano's observed 768×1376 PNG is proportionally contained into 576×1024 without crop or stretch. The template overlays exact approved copy on an opaque 448-pixel panel; its remaining visual region is 576 pixels tall. Background and scene directions are separate, with interaction/hand instructions belonging to the scene.

Provider documentation checked: [Klein background API](https://fal.ai/models/fal-ai/flux-2/klein/4b/api), [Klein edit API](https://fal.ai/models/fal-ai/flux-2/klein/4b/edit/api), [Nano Banana Pro edit API](https://fal.ai/models/fal-ai/nano-banana-pro/edit/api). The [Nano model page](https://fal.ai/models/fal-ai/nano-banana-pro/edit) listed $0.15 per 1K/2K image when checked September 22, 2026. Prices can change.

## Live Loopy probe

Five paid image calls total, in two bounded runs:

1. Klein background + simple Klein scene + handheld Klein scene: three calls. Saved artifacts: `/private/tmp/artist-v2-live-network-20260922`. Both scenes failed direct inspection: camera duplication in the simple scene, product intrusion beneath the copy panel, and an ineffective loop interaction. These are failure evidence, not accepted creatives.
2. Reuse the same saved original/background with Nano Banana Pro for simple and handheld scenes: two calls. Artifacts: `/private/tmp/artist-v2-nano-20260922`. Explicit lower-half framing fixes panel occlusion. The handheld result closely follows the source orientation, glossy cherry finish, camera arrangement and plausible finger-through-loop interaction. The simple result changes the small loop inscription/markings; it still requires changes or human scrutiny. No automated or human approval was fabricated for these diagnostics.

The original reference is itself a lifestyle image with the case inverted. Directions must remain within what that source substantiates. A cleaner verified gallery photo is preferable for a new product-only brief; no additional paid speculative retries were run. Reference conditioning reduces errors but does not guarantee product identity.

The diagnostic rendered a copy revision with zero extra provider calls and a handheld revision using the saved background with one extra scene call. Memory-backed workflow tests cover full first-ad=2, copy-only=0, scene-only=1, changed environment=2, and geometry=2 call counts, as well as explicit fresh variations. Environment revision counts have not been live-tested. The live probe exercises provider/rendering feasibility, not deployed Supabase persistence. That verification requires configured Supabase and the integrated deployment.

## Regression coverage

Tests exercise two-stage ordering, mandatory original/background references, saved-plan validation, exact copy/font fit, both templates, emoji rendering, input provenance, unknown-attempt refusal, missing bytes before spend, provider-result recovery after upload/checkpoint errors, composition/review recovery across a serialized reload, historical approval preservation, and revocation before re-review. Fixtures are explicitly test-only and never a production fallback.
