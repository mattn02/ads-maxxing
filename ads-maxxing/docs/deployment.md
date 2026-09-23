# Vercel deployment

## Reviewer and pricing update

The September 22 follow-up release switches the production `FINAL_AD_REVIEW_MODEL` and code default to `google/gemini-2.5-flash`. It includes the local Shopify price/currency and UI changes excluded from the first release. The existing free Ling fallback remains configured for model-access denial.

The shared acceptance guard now matches migration 005: failed/unavailable reviews, failing deterministic checks, and `needs_changes` verdicts cannot be accepted. The UI explains the next action, and the service rejects invalid acceptance before mutating the variant. Saved images remain available for review retries and download. No database migration is required.

Deployment: https://vercel.com/matt-gpt2/ads-maxxing/8QuukxWVCbERjZKrnFEcE3Mevx5r. Tests and live review probes were skipped at the user's request; the Vercel production build is required to publish. The verification below is historical evidence for the initial release, not a test run of this update.

## Initial release

Deployed September 22, 2026 (America/Los_Angeles).

- Production: https://ads-maxxing.vercel.app
- Vercel project: https://vercel.com/matt-gpt2/ads-maxxing
- Deployment: https://vercel.com/matt-gpt2/ads-maxxing/6NY1Arap7qXaQhXisyAP3jfkBRYz
- Repository: https://github.com/mattn02/ads-maxxing

The project runs on the existing mattGPT Hobby team. No plan upgrade or custom domain was purchased. The `vercel.app` address is assigned by Vercel; provider API usage remains separate.

## Configuration

`vercel.json` selects Next.js, `npm run build -- --webpack`, and Fluid compute. Workflow and chat routes declare the Node runtime and a 300-second maximum duration. Build traces include Geist, Twemoji SVGs, and Sharp. Supabase remains the durable database and private image store.

The six application variables from `.env.local` were configured for the production environment. The Supabase URL and publishable key are configuration; Supabase secret, Firecrawl key, fal key, and AI Gateway key are Vercel secrets. The unused JWKS setting and local Vercel OIDC token were not copied. `.vercelignore` excludes local environment files, agent resources, generated output, and build metadata from uploads.

This release was uploaded from the local application directory using the Vercel CLI. Automatic GitHub linking failed because Vercel could not access the repository. Pushes therefore do **not** automatically redeploy. For future Git integration, authorize the repository in Vercel and set its Root Directory to `ads-maxxing` (the application is nested one level below the Git repository root).

Additional local UI and product-price changes appeared after the source upload. They are not part of this verified deployment. Re-run the checks before deploying that later work. The verification below describes the uploaded snapshot.

To redeploy from this application directory with the Vercel CLI installed and authenticated:

```sh
vercel deploy --prod --scope matt-gpt2
```

## Checks completed

- All 147 automated tests passed, plus ESLint, TypeScript, and a local production webpack build.
- Vercel installed dependencies and completed its production build successfully; deployment status is `READY`.
- The public homepage returned HTTP 200 without Vercel authentication.
- Hosted anonymous sign-in, session/brand APIs, Secure/HttpOnly/SameSite cookies, cross-origin mutation rejection, and cross-owner campaign denial passed.
- In the production browser, Loopy Cases homepage research completed using live services. Its logo, positioning, inferred voice/audience, palette and suggested campaign directions displayed successfully.
- A full browser reload restored that brand kit and the campaign-direction checkpoint. No ad was generated during this deployment check.
- The live Supabase harness passed private byte storage, signed URLs, campaign reloads, saved review/acceptance, historical approval retention, ownership isolation, and denied client mutations. These are synthetic persistence checks, with zero paid image calls. Its outdated fixture was updated to include an actual stored-byte check and the review-linked acceptance timestamp required by migration 005.

## Remaining assignment verification

This deployment check does not establish a hosted end-to-end image generation, feedback, approval and download run, or five complete ecommerce campaigns. The UI still uses custom components rather than AI Elements. The author's own note, Excalidraw diagram and Loom walkthrough remain author deliverables, as required by `AGENTS.md`.
