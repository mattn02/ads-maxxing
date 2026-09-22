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

Apply [`supabase/migrations/202609220001_workflow.sql`](supabase/migrations/202609220001_workflow.sql) in your Supabase project's SQL editor and enable **anonymous sign-ins** in Authentication. The migration creates the private `creative-assets` bucket. See [Supabase setup and recovery](docs/supabase-setup.md) for provisioning, permissions and verification. Missing Supabase configuration produces a setup error; production has no local-file fallback.

```sh
npm run dev -- --hostname 127.0.0.1
```

Open [localhost:3000](http://localhost:3000). The initial workspace request establishes a private anonymous identity using HttpOnly cookies. Reloading in the same browser restores its campaigns. Clearing cookies or using another browser creates a different identity; cross-device account recovery is not implemented.

Supported environment aliases are `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `AI_GATEWAY_API_KEY`. Keep all provider keys and the Supabase secret server-only. Optional `CONCIERGE_MODEL`, `RESEARCHER_MODEL` and `REVIEWER_MODEL` overrides select each language role; the default is `inclusionai/ling-3.0-flash-vl-free` through AI Gateway. A replacement reviewer must support image input and the structured result tool. fal model requests have model-specific contracts in `lib/workflow/fal.ts`.

For Vercel, configure the same environment, use the Node runtime and `npm run build -- --webpack`, and provision Supabase first. Durable data lives outside the deployment filesystem. A successful local build does not establish that hosted Auth, Storage or a deployed workflow has been verified.

## Use the workspace

1. Start a campaign and send `Research https://www.loopycases.com`. Homepage research builds the brand kit, then **stops for your direction**. It does not silently choose a product. Select a suggested direction, give an explicit promotion scope, or paste a product/collection URL. A direct product request can enter campaign research immediately.
2. Inspect the product choices and source images. Select the intended product; correct a misclassified asset, brand finding or offer eligibility when needed. Unknown evidence stays unknown. Offers require source evidence and your eligibility confirmation; an evergreen ad can proceed without one.
3. Ask for a brief, inspect the selected real photo, exact copy, design and execution plan, and edit as needed. Source photo bytes are pinned to private Storage before approval. **Approve the brief and photo**, then generate. Approval itself does not call fal.
4. Inspect the final 576 × 1024 PNG and its review findings. The reviewer checks the original photo, rendered ad, approved brief and source evidence. A passing review still needs your separate **Approve ad** action. Uncertain or failed reviews cannot be approved through an override.
5. Give feedback such as `Keep the scene; shorten the headline` or `Show a hand using the loop`. The next brief references its parent variant and needs fresh approval. The saved plan explains which image stages can be reused. Reload and resume the campaign to inspect saved work or finish a recoverable operation.

**Every research edit requires a fresh pending brief and approval**, including asset corrections, product selection, brand corrections and offer confirmation. Brief edits and preference changes also revoke pending approval. Previously generated ads keep their original research, copy, lineage and approvals.

## How it works

The Next.js App Router serves a React/Tailwind workspace and authenticated API routes. Chat uses the Vercel AI SDK `useChat` hook and a `ToolLoopAgent` concierge. Native tool activity streams while the server owns workflow rules and trusted history. The current UI is custom; AI Elements components are not yet integrated.

The four roles are modules, not independently running workers:

| Component | Responsibility |
| --- | --- |
| Concierge (`lib/workflow/agents/concierge.ts`) | Interprets requests, records preferences and invokes bounded, typed workflow tools. It has no human approval tool. |
| Researcher (`lib/workflow/agents/researcher.ts`, `lib/workflow/research/`) | Uses Firecrawl branding, markdown, HTML and links; extracts products/assets with provenance; synthesizes voice, audience and evidence-backed offers. Scope follows actual user direction. |
| Workflow (`lib/workflow/service.ts`) | Enforces grounding, revision invalidation, approval, execution plans, generation checkpoints, feedback and final approval. |
| Artist (`lib/workflow/agents/artist.ts`, `lib/workflow/creative/`) | Generates an environment with fal FLUX.2 Klein 4B, then a scene with Nano Banana Pro edit using both the pinned original product and background. Composes exact approved copy in code. |
| Reviewer (`lib/workflow/agents/reviewer.ts`) | Combines deterministic provenance/layout checks with a separate vision review. Saves pass, needs-changes or needs-human findings without automatic regeneration. |
| Persistence (`lib/supabase/server.ts`, `lib/workflow/sessions.ts`, `lib/workflow/storage.ts`) | Verifies identity, enforces ownership and campaign leases, commits versioned state and stores immutable image bytes. |

Research uses at most three pages for brand discovery, or eight attempts and three product pages for campaign research, within a three-minute budget. Successful retrieval is checkpointed before optional language-model synthesis. Failed pages produce warnings and retained partial results. Discovery is same-store and bounded; this is not a full catalog crawl. Product/asset IDs link a brief to saved evidence, and corrections are explicit user-supplied evidence. Voice and audience are labeled inferences; observed sale text does not itself prove eligibility.

The artist generates images without the final headline/CTA, then renders the exact approved copy with two fixed templates. Scene normalization preserves aspect ratio without cropping or stretching. Output is a 9:16 PNG with a 448-pixel opaque copy panel and a 576-pixel visual region. Store typography can be observed, but rendering uses bundled Geist; it does not download or license store fonts. Emoji use bundled Twemoji SVGs. Unsupported glyphs and copy that cannot fit return actionable errors before generation.

The default image plan uses two paid fal calls for a new ad. With compatible saved assets, copy-only changes use **zero**, scene/pose changes use **one**, and environment or geometry changes use **two**. Explicit fresh variations bypass the relevant reuse. These counts exclude language-model/reviewer calls; plans validate exact saved inputs and bytes before spending. See [artist verification](docs/artist-verification.md) for model settings, the dated pricing check and the distinction between mocked call-count tests and paid probes.

## Data and recovery

Exactly five application tables keep the ownership and creative history explicit:

| Table | Saved data |
| --- | --- |
| `brands` | Owner-specific store identity and current brand kit. |
| `research_snapshots` | Immutable, versioned source findings and user corrections. |
| `campaigns` | Current research/brief pointers, chat, preferences, events and lease/revision state. |
| `ad_versions` | Brief/design/copy, ancestry, approval/review status, generation and fixed stage checkpoints. |
| `assets` | Original product/logo, generated background/scene and final ad records with hashes and private object paths. |

Each API request verifies the caller through Supabase Auth. Browser roles have owner-scoped read policies; mutations use server-only RPCs. Privileged server reads also filter the verified owner. Campaign leases and increasing revisions reject concurrent or stale writes across server processes. The Supabase secret never reaches the browser.

Source images must be observed in saved research and pass download validation before capture. fal receives fresh, short-lived signed URLs for the pinned source and background. Provider results are copied into private Storage rather than served indefinitely from fal URLs. Preview and download use authenticated application routes backed by those durable bytes.

Each paid stage records its attempt **before** calling the provider and its result **before** downloading. An ambiguous attempt cannot automatically submit another paid request. A saved provider result can be downloaded again; a saved background or scene can be reused; saved images can be recomposed without repeating successful paid stages. Ready object paths are immutable, with hash checks for interrupted uploads. The final ad is persisted before review, so a review failure retains a viewable output and can be retried separately.

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

The test suite uses mocked providers and temporary/in-memory state; running it does not incur paid generation. It exercises approval and grounding rules, staged research, reference provenance, reuse plans, recovery, exact-copy rendering, ownership and persistence contracts. SQL and hosted-service checks are documented separately in [Supabase setup](docs/supabase-setup.md).

[Research verification](docs/research-implementation.md) records homepage/product checks for Loopy Cases, BlendJet, Allbirds, Peak Design and Ugmonk. These checks establish extraction behavior, not five approved ad campaigns. [Artist verification](docs/artist-verification.md) records five paid Loopy probes: the Klein scene attempts failed visual inspection; Nano improved the handheld result, while small markings in the simple scene remained uncertain. Mocked reuse tests and diagnostic rendering are not deployed end-to-end verification.

The main limits are product fidelity, incomplete store markup and operational hardening. The extractor supports structured product/gallery/offer evidence, not every arbitrary DOM gallery; unresolved assets need user confirmation. Asset role suggestions do not establish product or variant ownership; grounding still requires saved product evidence or an explicit user correction. There is no browser fallback or invented customer evidence. Source bytes retain their original orientation/color metadata. Reference-conditioned generation and vision review cannot guarantee exact logos, tiny markings or physical details. Review findings need human inspection.

There is no durable job queue, global spending cap, cross-device anonymous account recovery or automatic cleanup. Research/provider calls are bounded and automatic LLM retries are disabled, but those controls do not replace production rate limits or spend monitoring. This README does not claim a deployed Vercel URL or successful hosted verification; consult the linked records for the exact evidence.

Twemoji artwork is by Twitter and other contributors, distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [source](https://github.com/jdecked/twemoji). SVG artwork is unchanged apart from display sizing.
