# Architecture walkthrough

This describes the current working-tree implementation, inspected on September 22, 2026. It is a study guide for explaining the project, separate from your author-written submission note. The [small diagram](architecture-simple.md) is the version to recreate in Excalidraw.

## 1. The overall design

The app turns a Shopify store URL into researched, editable portrait ads. It is one Next.js application with a React workspace and server-side workflow modules. Firecrawl, AI Gateway, fal.ai, and Supabase provide external capabilities. The agent roles are functions/modules inside that application, not separate deployed workers.

The central design choice is to let models interpret and create, while application code controls permissions, product references, state transitions, image composition, and persistence.

| Piece | What it does | Main code |
| --- | --- | --- |
| Workspace | Brand onboarding, campaign direction, product selection, chat, ads, feedback, and acceptance | `app/workflow-console.tsx`, `components/workspace/` |
| API routes | Validate requests, verify the user, lock a campaign, invoke work, and return saved state | `app/api/` |
| Workflow service | Coordinates research, briefs, generation, review, revisions, and approval rules | `lib/workflow/service.ts` |
| Researcher | Retrieves store evidence, extracts products and photos, and synthesizes brand context | `lib/workflow/agents/researcher.ts`, `lib/workflow/research/` |
| Concierge | Interprets chat and invokes typed workflow tools using the AI SDK | `lib/workflow/agents/concierge.ts` |
| Artist and renderer | Generate a scene from a real product reference, then add exact copy and the saved logo | `lib/workflow/agents/artist.ts`, `lib/workflow/creative/` |
| Reviewer | Checks saved evidence, image structure, product fidelity, copy, and brand fit | `lib/workflow/agents/reviewer.ts` |
| Persistence | Saves ownership, campaign state, history, and private image bytes | `lib/supabase/server.ts`, `lib/workflow/sessions.ts`, `lib/workflow/storage.ts` |

**Deployment shape:** Next.js is intended to run on Vercel's Node runtime. Supabase holds durable state outside the application process. Reading this code does not establish that the deployed Vercel workflow has been verified.

## 2. From a URL to usable research

### Brand setup happens before creative generation

Submitting a URL creates or opens a brand setup session. The server researches the store homepage and up to two supporting company pages. Firecrawl supplies branding, page content, HTML, and links. The researcher builds a brand kit and suggested campaign directions, saves them, and stops for user input.

The user can inspect and correct the brand, then choose what to promote. A saved brand can be reused across campaigns. Even a product URL submitted through onboarding first establishes the brand; that original page becomes a suggested starting point.

### Product research uses structured Shopify data

Once the user supplies a campaign direction, discovery follows relevant links from the same store. Firecrawl can discover pages and read collection pages. For product URLs, the primary fetch is Shopify's public `/products/<handle>.js` endpoint, rather than scraping arbitrary product-page HTML.

That response provides product identity, description, options, variants, and associated gallery images. The extractor turns these into product and asset records with stable IDs and source evidence. The product-to-photo relationship matters: an attractive image somewhere on the page is not sufficient proof that it depicts the selected product or variant.

The current production path supports Shopify stores with public product data. Campaign retrieval is bounded to eight page attempts, including at most three product pages, with a three-minute retrieval budget. It is a focused research pass, not a full catalog import.

### Observations, inferences, and user decisions stay distinct

| Kind of information | How it is established |
| --- | --- |
| Product identity and associated photos | Structured store evidence, including product/variant relationships |
| Brand colors, logo candidates, typography | Retrieved branding and source evidence; usable logos are verified or user-confirmed |
| Voice and audience | LLM inference from store copy, with provenance and user overrides |
| Promotion wording | Exact source quotes; observation alone does not establish eligibility |
| Campaign direction | User choice or explicit instruction |
| Offer eligibility | Explicit user confirmation for the product |

Successful retrieval is checkpointed before optional LLM synthesis. If synthesis fails, observed facts and eligible photos remain saved, with warnings. Missing offer evidence can result in an evergreen ad without a discount.

**Why this matters:** factual inputs remain traceable, and model inference does not silently become proof of a product feature or promotion.

## 3. How the workflow actually runs

There are two entry paths into the same workflow service:

**Campaign controls:** a Generate action records a request ID, the chosen direction, and an authorization timestamp. The server researches the campaign, chooses the first included member with a ready reference, drafts a brief, records approval under that generation request, and generates the creative. Other included products/variants can be selected and generated individually. The collection is not automatically turned into a full batch of ads.

**Chat:** the AI SDK `useChat` client connects to `/api/chat`. A `ToolLoopAgent` concierge can research, prepare a brief, generate an already approved brief, review an ad, and save preferences. It cannot grant approval. A chat-drafted brief follows the separate human brief-approval path.

This distinction is important when explaining human control: **the campaign Generate button authorizes automated planning and generation together; not every generated brief receives a separate human inspection.** The explicit manual brief path is also implemented. Both paths require saved approval before the image stage.

The campaign flow is split across requests. After saving a research or planning step, the server returns a `nextAction`. The browser calls `continueCampaign` while that action is `continue`; it pauses for missing input or explicit retry. This gives later stages a fresh request budget. Progress is read from saved state through polling.

Chat text and native tool activity stream through the AI SDK. The server loads trusted message history, accepts only the new user message, and saves the resulting conversation. Tool mutations are serialized within a turn, and the campaign lease prevents overlapping writes across requests.

**Important operational consequence:** this is a persisted workflow advanced by requests, not a durable background queue. An active chat stream is consumed server-side even if the browser disconnects, but future campaign continuation requests still depend on a client returning, and a killed server process does not keep working.

## 4. From a real product photo to a finished ad

### A. Save the creative contract

The brief binds the selected product and variant, reference asset, research snapshot, headline, CTA, optional eligible offer, visual direction, design, and parent ad version. The server checks those relationships against saved research.

Before generation, it downloads the verified reference into private Supabase Storage. This is the **pinned original**: later generation and review use saved bytes, rather than trusting that the store's URL will always return the same photo. A usable logo is pinned too. Design tokens and font inputs are snapshotted, and copy is checked for valid glyphs and layout fit.

An execution plan states whether to reuse a compatible scene or generate one. The plan is saved with the brief, so cost and input selection are decided before the paid image request.

### B. Generate one complete scene

The artist gives fal.ai a temporary signed URL to the pinned original and a scene prompt. The configured model is `fal-ai/nano-banana-pro/edit`, with one image, portrait 9:16, PNG output, and 1K resolution.

The model creates the complete environment and product scene. It is reference-conditioned generation: it uses the real product photo, but does not guarantee an unchanged product cutout. Fine physical details can still drift, which is why original-versus-output review matters.

### C. Render the exact advertising copy in code

The application downloads the fal result, normalizes it to a 576 × 1024 PNG, and saves that scene. `next/og`'s `ImageResponse` renders the scene together with the approved headline, CTA, eligible commercial copy, and saved logo. Sharp handles logo normalization; font fitting and rendering use the saved font inputs.

The generated scene does not intentionally contain the final advertising text. The headline/CTA are pixels in the finished image because the application renders them into the PNG.

**Why split scene generation from composition?** It gives control over exact wording and layout, preserves offer restrictions, and permits copy changes without paying for another scene. It does not guarantee that every background will make text readable; visual review still checks the completed result.

### D. Persist, then review

The final PNG is uploaded to Storage, and its ad version is saved before review begins. The reviewer combines deterministic checks—dimensions, reference ownership, saved inputs, exact-copy metadata, layout fit—with a vision model that receives the original photo, final ad, brief, and source evidence.

The findings cover product fidelity, text legibility, claim accuracy, and brand fit. They are advisory. A completed ad stays visible even when review fails or recommends changes. The user chooses acceptance, feedback, or regeneration; review does not automatically spend on another image.

## 5. Feedback creates history instead of overwriting it

An edit targets a saved ad and creates a new brief/version with `parentVariantId` and the feedback text. The refinement model interprets the requested change, while the server validates that the product reference remains grounded in the campaign's current research.

| User action | Image work |
| --- | --- |
| “Shorten the headline; keep the scene” | Reuse a compatible saved scene and render new text; zero new fal calls |
| “Show someone using the product” | Generate a new complete scene; one fal call |
| Explicit visual regeneration | Generate a new complete scene; one fal call |
| Retry review | Re-examine the saved ad; no new scene |
| Accept ad | Persist the user's acceptance; no generation |

These counts exclude text-model and review-model calls. Reuse depends on a server-computed fingerprint of scene inputs and settings, plus checks that the saved bytes still exist. The model cannot simply declare an incompatible image reusable.

Research, product, and scope changes invalidate the pending brief. Existing ad versions retain their historical research and creative inputs. Re-reviewing an accepted ad clears its acceptance until the user decides again.

## 6. What Supabase stores

The application separates **records describing work** in Postgres from **image bytes** in a private Storage bucket named `creative-assets`.

| Table | Purpose |
| --- | --- |
| `brands` | Owner-specific store identity, current brand kit, and reusable completed context |
| `research_snapshots` | Immutable source findings and corrections; referenced by campaigns and ad versions |
| `campaigns` | Current research/brief pointers, messages, preferences, events, workflow state, and concurrency metadata |
| `ad_versions` | Briefs, generation metadata, parent relationships, checkpoints, review, and acceptance |
| `assets` | Asset type, source/provenance, hashes, storage state, and object path |

A brand has campaigns; a campaign has ad versions; each version refers to the research and assets that produced it. Products, catalog variants, and campaign membership live inside research snapshots rather than dedicated product tables. An **ad variant** means a creative revision; a **Shopify variant** means a catalog option such as a color or device size.

Brand onboarding also uses a `campaigns` row, distinguished by `purpose: brand_setup`. The TypeScript `Session` is a hydrated application view assembled from several tables, not a separate sessions table.

`saveSession` commits through a Postgres RPC. It references already saved research snapshots instead of repeatedly sending their full contents. This keeps growing creative history from multiplying large research payloads on every save.

The asset path is:

1. Store photo → validated download → pinned original in private Storage.
2. Pinned original → temporary signed URL → fal image request.
3. fal result → download → normalized saved scene in private Storage.
4. Scene plus exact text/logo → renderer → final PNG in private Storage.
5. Browser preview/download → authenticated `/api/assets/[id]` or `/api/outputs/[id]` → saved bytes.

The temporary fal URL is a recovery input, not the permanent image address shown to users.

## 7. Ownership, concurrent actions, and recovery

Supabase anonymous Auth establishes a private identity with HttpOnly cookies. Every API request verifies the caller; ownership is not accepted from the request body. Server reads filter by that owner. Browser database policies are owner-scoped, and mutations use privileged server RPCs. Provider and Supabase secret keys stay on the server.

A campaign **lease** permits one active mutation at a time, and an increasing revision rejects stale commits. Persisted request IDs make duplicate dispatch of the same campaign intent harmless. These controls complement one another: request IDs identify the work; leases/revisions protect the state being changed.

Before calling fal, the server saves that an attempt began. After a response, it saves the provider result before downloading the image, then saves the scene checkpoint before final composition.

| Failure point | Recovery behavior |
| --- | --- |
| Research page or optional synthesis fails | Retain available findings and report warnings or a recoverable error |
| Provider result is saved but download/upload fails | Recover using the saved result while its URL remains usable |
| Scene is saved but composition fails | Re-render from saved bytes without another image request |
| Review is unavailable | Keep the final ad visible for the user's decision |
| Paid request outcome is unknown | Stop automatic retry; an explicit new attempt can require duplicate-charge acknowledgment |

This reduces accidental repeated spending but is not an exactly-once guarantee across an external provider and a database. There is no durable queue, global spend cap, cross-device anonymous account recovery, or automatic cleanup.

## 8. What to say accurately in the walkthrough

- The product pauses after brand research for campaign direction, and accepts human feedback on saved ads. The button-driven flow can then draft and generate autonomously within that authorization.
- AI SDK powers the chat/tool loop. The workspace is custom React UI; AI Elements is not currently integrated, despite being requested in the assignment.
- Firecrawl researches the brand and discovers pages; Shopify product JSON establishes product/photo relationships. An LLM does not invent the catalog.
- fal produces the scene, and application code renders the exact advertising copy into the final image.
- Supabase stores both state/history and durable private images. Reloading reconstructs the workspace from that saved data.
- Automated review is advisory, and reference conditioning cannot guarantee perfect product fidelity.
- Source inspection establishes implementation, not a successful deployed run. The repository's verification notes distinguish extraction checks from five completed ad campaigns; those are different deliverable claims.

For a code walkthrough, start with `service.ts`, then follow `researcher.ts` → `shopify-fetch.ts`, `artist.ts` → `render.tsx`, and `sessions.ts` → `storage.ts`. Those paths explain how a store photo becomes a persisted ad without needing to memorize every UI component.
