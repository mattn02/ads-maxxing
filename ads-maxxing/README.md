# Ad creative workspace

A working **research → approved brief → portrait ad → review → feedback** workflow for ecommerce marketers. Start with a store such as [Loopy Cases](https://www.loopycases.com), choose what to promote, and generate ads grounded in its actual product photography. The workspace saves research, creative revisions, approvals and image bytes in Supabase.

This is engineering documentation. The assignment's author-written note, Excalidraw diagram and Loom walkthrough remain separate deliverables.

## Run locally

Use Node.js **20.9 or newer** and install the locked dependencies:

```sh
npm ci
```

Create `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
FIRECRAWL_API_KEY=...
FAL_AI_API_KEY=...
AI_GATEWAY_KEY=...
```

Apply all three SQL files in [`supabase/migrations/`](supabase/migrations/) in filename order using your Supabase project's SQL editor, then enable **anonymous sign-ins** in Authentication. The migrations create the private `creative-assets` bucket and protect shared brand corrections. See [Supabase setup and recovery](docs/supabase-setup.md) for provisioning, permissions and verification. Missing Supabase configuration produces a setup error; production has no local-file fallback.

```sh
npm run dev -- --hostname 127.0.0.1
```

Open [localhost:3000](http://localhost:3000). The initial workspace request establishes a private anonymous identity using HttpOnly cookies. Reloading in the same browser restores its campaigns. Clearing cookies or using another browser creates a different identity; cross-device account recovery is not implemented.

Supported environment aliases are `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `AI_GATEWAY_API_KEY`. Keep all provider keys and the Supabase secret server-only. Optional `CONCIERGE_MODEL`, `RESEARCHER_MODEL`, and `BRIEF_MODEL` overrides select the text roles. Initial briefs, refinements, and copy repairs use `BRIEF_MODEL` (default `openai/gpt-5.4-nano`) with provider-enforced structured output and a 4096-token budget; overrides must support JSON schema output. Research synthesis defaults to `openai/gpt-5.4-nano` because it supports provider-enforced structured output; the concierge defaults to `inclusionai/ling-3.0-flash-vl-free`. `FINAL_AD_REVIEW_MODEL` configures the stronger final creative review and defaults to `openai/gpt-5.4`; it must support image input. If the Gateway denies access to that model, review falls back once to the separately configurable `FINAL_AD_REVIEW_FALLBACK_MODEL`, which defaults to `inclusionai/ling-3.0-flash-vl-free`. The single fal image request is isolated in `lib/workflow/fal.ts`.

For Vercel, configure the same environment, use the Node runtime and `npm run build -- --webpack`, and provision Supabase first. Durable data lives outside the deployment filesystem. A successful local build does not establish that hosted Auth, Storage or a deployed workflow has been verified.

## Use the workspace

1. Start a campaign and send `Research https://www.loopycases.com`. Homepage research builds the brand kit, then **stops for your direction**. It does not silently choose a product. Select a suggested direction, give an explicit promotion scope, or paste a product/collection URL. A direct product request can enter campaign research immediately.
2. Inspect the product choices and Shopify gallery images. Select the intended product; the app deterministically chooses its variant-associated image, featured image, or first associated gallery image. Loose page images never become generation references. Offers require source evidence and your eligibility confirmation; an evergreen ad can proceed without one.
3. Ask for a brief, inspect the selected real photo, exact copy, design and execution plan, and edit as needed. Source photo bytes are pinned to private Storage before approval. Click **Approve brief & generate** to approve this revision and start its planned image calls. The server records approval before generation; the combined button performs both actions. An already approved revision shows **Generate approved brief**.
4. Inspect the final 576 × 1024 PNG and its advisory review feedback. The reviewer compares the original photo, rendered ad, approved brief and source evidence. You choose **Accept ad**, edit with feedback, or **Regenerate visual**; review findings never trigger a hidden retry.
5. Give feedback such as `Keep the scene; shorten the headline` or `Show a hand using the loop`. Copy-only changes reuse the saved scene; visual changes and explicit regeneration create one fresh complete scene. Every version retains its parent and the original remains intact.

**Every research edit requires a fresh pending brief and approval**, including asset corrections, product selection, brand corrections and offer confirmation. Brief edits and preference changes also revoke pending approval. Previously generated ads keep their original research, copy, lineage and approvals.

## How it works

The Next.js App Router serves a React/Tailwind workspace and authenticated API routes. Chat uses the Vercel AI SDK `useChat` hook and a `ToolLoopAgent` concierge. Native tool activity streams while the server owns workflow rules and trusted history. The current UI is custom; AI Elements components are not yet integrated.

The four roles are modules, not independently running workers:

| Component | Responsibility |
| --- | --- |
| Concierge (`lib/workflow/agents/concierge.ts`) | Interprets requests, records preferences and invokes bounded, typed workflow tools. It has no human approval tool. |
| Researcher (`lib/workflow/agents/researcher.ts`, `lib/workflow/research/`) | Uses Firecrawl branding, markdown, HTML and links; extracts products/assets with provenance; synthesizes voice, audience and evidence-backed offers. Scope follows actual user direction. |
| Workflow (`lib/workflow/service.ts`) | Enforces grounding, revision invalidation, approval, execution plans, generation checkpoints, feedback and final approval. |
| Artist (`lib/workflow/agents/artist.ts`, `lib/workflow/creative/`) | Sends the pinned Shopify product photo to one Nano Banana Pro edit call to create the complete environment and product scene, then composes exact approved copy in code. |
| Reviewer (`lib/workflow/agents/reviewer.ts`) | Combines deterministic provenance/layout checks with a separate vision review. Saves advisory findings for the user's accept, edit or regenerate decision. |
| Persistence (`lib/supabase/server.ts`, `lib/workflow/sessions.ts`, `lib/workflow/storage.ts`) | Verifies identity, enforces ownership and campaign leases, commits versioned state and stores immutable image bytes. |

Research uses at most three pages for brand discovery, or eight attempts and three product pages for campaign research, within a three-minute retrieval budget. Shopify product data establishes gallery and variant-image ownership; there is no research-photo model. Successful retrieval is checkpointed before optional language-model synthesis. Failed pages produce warnings and retained partial results. Discovery is same-store and bounded; this is not a full catalog crawl. Product/asset IDs link a brief to saved evidence. Voice and audience are labeled inferences; observed sale text does not itself prove eligibility.

The artist generates images without the final headline/CTA, then renders the exact approved copy over the full-bleed scene. The overlay itself is transparent: the verified logo is fixed to the top-left, the headline stays at the top, and commercial copy plus the CTA sit at the bottom. Scene normalization fills the 9:16 canvas. The brief snapshots an exact Fontsource match for the detected heading or body family when a static regular face is available, and otherwise snapshots bundled Geist. Fitting and rendering use the same saved font bytes. Emoji use bundled Twemoji SVGs. Unsupported glyphs and copy that cannot fit return actionable errors before generation.

The default image plan uses one paid fal call for a new ad. With a compatible saved scene, copy/style changes use **zero** image calls; any setting, subject, pose or composition change uses **one**. Explicit regeneration also uses one. These counts exclude language-model/reviewer calls; plans validate exact saved inputs and bytes before spending. See [artist verification](docs/artist-verification.md) for model settings and the distinction between mocked call-count tests and paid probes.

## Data and recovery

Exactly five application tables keep the ownership and creative history explicit:

| Table | Saved data |
| --- | --- |
| `brands` | Owner-specific store identity and current brand kit. |
| `research_snapshots` | Immutable, versioned source findings and user corrections. |
| `campaigns` | Current research/brief pointers, chat, preferences, events and lease/revision state. |
| `ad_versions` | Brief/design/copy, ancestry, approval/review status, generation and fixed stage checkpoints. |
| `assets` | Original product/logo, generated complete scene and final ad records with hashes and private object paths. Nullable legacy background fields remain in the database for now. |

Each API request verifies the caller through Supabase Auth. Browser roles have owner-scoped read policies; mutations use server-only RPCs. Privileged server reads also filter the verified owner. Campaign leases and increasing revisions reject concurrent or stale writes across server processes. The Supabase secret never reaches the browser.

Source images must be associated with the selected product by Shopify and pass download validation before capture. fal receives one fresh, short-lived signed URL for that pinned source. Provider results are copied into private Storage rather than served indefinitely from fal URLs. Preview and download use authenticated application routes backed by those durable bytes.

The paid scene stage records its attempt **before** calling the provider and its result **before** downloading. An ambiguous attempt cannot automatically submit another paid request. A saved provider result can be downloaded again; a saved scene can be reused and recomposed without repeating generation. Ready object paths are immutable, with hash checks for interrupted uploads. The final ad is persisted before review, so unavailable or critical review feedback still leaves the image available for the user's accept, edit or regenerate decision.

Disconnecting the browser does not deliberately cancel stream consumption, but this is not a durable job queue. If a worker dies before saving a provider result, or the recovery URL expires, operator inspection and a deliberately approved new version may be necessary. No fixture or local file silently substitutes for a failed production provider.

To inspect an older local demo before importing it, run the explicit **dry run**:

```sh
node --import tsx scripts/import-local.ts --owner DESTINATION_USER_UUID --directory /absolute/local-output
```

Use an existing destination identity. The [import instructions](docs/supabase-setup.md#importing-local-demos) describe `--apply`, conflicts and legacy provenance limits. Import never edits the source files or calls research/image providers. Legacy final images can remain viewable without being treated as reusable two-stage assets or as proof of the historical source photo.

## Verification and limits

```sh
npm test
npm run lint
npm run typecheck
npm run build -- --webpack
```

The test suite uses mocked providers and temporary/in-memory state; running it does not incur paid generation. It exercises approval and grounding rules, staged research, reference provenance, reuse plans, recovery, exact-copy rendering, ownership and persistence contracts. The integrated implementation passed 59 tests, lint and TypeScript checking on September 22, 2026. SQL and hosted-service checks are documented separately in [Supabase setup](docs/supabase-setup.md). Live Supabase checks passed for two-owner isolation, private bytes and signed URLs, reloads, final image/review/approval persistence, historical approvals, denied client mutations and repeated legacy imports. Those harnesses used synthetic data and made no paid provider calls.

The optimized production webpack build also passed. A local browser check against live Supabase completed Loopy homepage research, paused for campaign direction, and restored its brand kit and suggestions after a full reload. A fresh identity also created a campaign and delivered its first chat message exactly once. These checks caught and fixed Next.js internal-hostname origin validation and React Strict Mode first-message cancellation. They did not generate another image or verify a Vercel deployment.

[Research verification](docs/research-implementation.md) records homepage/product checks for Loopy Cases, BlendJet, Allbirds, Peak Design and Ugmonk. These checks establish extraction behavior, not five approved ad campaigns. [Artist verification](docs/artist-verification.md) records the earlier model comparison that motivated the single Nano path; current mocked reuse tests and diagnostic rendering are not deployed end-to-end verification.

The main limits are product fidelity, incomplete store markup and operational hardening. The extractor supports structured product/gallery/offer evidence, not every arbitrary DOM gallery; unresolved assets need user confirmation. Asset role suggestions do not establish product or variant ownership; grounding still requires saved product evidence or an explicit user correction. There is no browser fallback or invented customer evidence. Source bytes retain their original orientation/color metadata. Reference-conditioned generation and vision review cannot guarantee exact logos, tiny markings or physical details. Review findings need human inspection.

There is no durable job queue, global spending cap, cross-device anonymous account recovery or automatic cleanup. Research/provider calls are bounded and automatic LLM retries are disabled, but those controls do not replace production rate limits or spend monitoring. Local application checks and live Supabase verification are recorded above. A deployed Vercel workflow and five complete live ad campaigns remain unverified; consult the linked records for the exact evidence.

Twemoji artwork is by Twitter and other contributors, distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [source](https://github.com/jdecked/twemoji). SVG artwork is unchanged apart from display sizing.
