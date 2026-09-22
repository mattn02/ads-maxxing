# Local product → ad experiment

A deliberately small test harness: URL → Firecrawl → inspect/select a real product photo → fal → local PNG. No database, auth, deployment, chat UI, or orchestration framework.

## Run

Install with `npm install`, then provide these variables in `.env.local` yourself:

- `FIRECRAWL_API_KEY`
- `FAL_AI_API_KEY`

`AI_GATEWAY_KEY` is not used: metadata plus an editable prompt template are enough for this experiment. No separate LLM call is made. Keys are referenced only on the server.

Run `npm run dev -- --hostname 127.0.0.1` and open http://127.0.0.1:3000.

1. Paste a product URL and click **Scrape URL**. Loopy Cases is the example store; a direct product page provides better results than its homepage.
2. Inspect the title, description, images, and raw scraped text. Select the real product image; you can also supply a public image URL if extraction misses it.
3. Edit the prompt, then click **Generate image**.
4. View/download the PNG. Edit the prompt and generate again to test feedback. Earlier outputs remain visible until a new scrape or page reload.

## Pieces

- `lib/workflow/firecrawl.ts`: one Firecrawl v2 scrape, requesting markdown and image URLs. Uses page metadata for title/description; no claims, audience, or brand details are inferred.
- `lib/workflow/prompt.ts`: editable ad prompt template, including headline, CTA, and product-preservation instructions.
- `lib/workflow/fal.ts`: one direct image-edit request using the actual selected photo. All model-specific settings live here.
- `lib/workflow/storage.ts`: saves each generated PNG plus a JSON record containing its prompt, reference URL, source page URL, model, seed, timestamp, and temporary provider URL under ignored `local-output/`.
- `app/api/scrape` and `app/api/generate`: thin HTTP wrappers; `app/api/outputs/[id]` serves saved PNGs.
- `app/page.tsx`: plain form and previews that call those endpoints.

The functions use plain values and have no UI dependencies. They can later be called from AI SDK tools or another workflow. Replacing storage or a provider only needs changes in its module. This prototype invokes fal's model API directly, not the hosted fal Agent chat product.

## Model and scope

[FLUX.2 klein 4B edit](https://fal.ai/models/fal-ai/flux-2/klein/4b/edit) is a low-cost, fast, four-step reference-image model. Output is one 576 × 1024 PNG (9:16). The current model page lists $0.01/megapixel; actual billing/rounding is controlled by fal. Firecrawl also uses credits. Calls are not automatically retried, avoiding accidental duplicate generation charges.

This tests plumbing, not production creative quality: inspect product fidelity and lettering yourself. The prompt asks the model to preserve the product, but it cannot guarantee pixel-exact preservation. Images scraped from a page may include banners/logos; human selection is intentional. A feedback edit creates a fresh image from the original reference plus the updated prompt.

Raw scrape results live in browser memory. Generated files survive reloads and server restarts, but there is no gallery/history loader yet. Reopen the saved `/api/outputs/<id>` URL or the PNG in `local-output/`. A download failure leaves the provider URL in the JSON file for recovery; do not pay to generate again just to retry a download.

Local testing only: bind to loopback. There is no authentication, rate limiting, durable job queue, or cancellation. A generation may continue and incur charges after a browser disconnect or timeout. No Supabase writes or deployments are performed.

## Checks

`npm run lint` and `npm run build` check the application. Test real provider credentials through the UI; failed requests display a retryable error without discarding a successful scrape or earlier generated images.

### Verification in this session

- Live Firecrawl scrape of Loopy Cases succeeded; text and real image previews displayed in the browser.
- Live fal requests returned HTTP 403. Check the key's permissions/model access and account credits. A real generated output is not yet verified.
- `npm run lint` passed.
- `npm run build -- --webpack` passed, including TypeScript checks. The default Turbopack build hit a local worker-port error in this environment.
- Isolated mocked checks passed for scrape URL normalization, reference-photo forwarding, 9:16 dimensions, PNG save/readback, invalid output IDs, and provider error handling. Mock output was confined to `/tmp`, not presented as a real generation.
