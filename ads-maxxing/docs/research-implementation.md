# Research implementation and verification

Engineering handoff, not the author's submission note.

The runtime uses bounded Firecrawl scrape/map stages, a versioned research snapshot, and an independent campaign workflow state. A homepage saves brand observations and stops at `awaiting_direction`. Campaign scope is established from the actual newest user message or a stable direction choice. Concierge arguments cannot invent that authorization. Direct product URLs collect missing company context and their structured product evidence; collections inspect at most three linked products and require a product selection.

JSON-LD provides product identity, gallery membership, explicit variants, numeric prices, and entity-scoped ratings. Source URLs, fetched times, bounded HTML, branding, links, and evidence remain in snapshots. Structured scripts are preserved before truncating oversized HTML. CDN resizing parameters are deduplicated while version parameters remain significant. Product offers provide variant identities where available; no variant photo association is inferred from its filename. A bounded vision pass classifies at most six shortlisted images using their real registry IDs. It can veto a structural photo (promotional overlay, multiple products, or uncertainty) or suggest an image role, but cannot grant product/variant ownership. Assessments are stored as inferred, separate from observed membership, and owner corrections take precedence. Downloads use the shared safe boundary with at most three concurrent requests, 1.2 MB per image, 7.2 MB total, 10 seconds per image, and one 60-second model call within the stage deadline. Unknown ownership remains in Unsorted until a saved owner correction. Model synthesis supplies labeled voice/audience and candidate promotions; failure preserves source facts. Promotions retain the complete matching source paragraph and default to unresolved eligibility. A user must confirm product and customer eligibility; stale/expired evidence fails brief validation.

A server brief resolves product and photo IDs, rejects other-product photos and unresolved variant associations, and checks offer scope/freshness. Prices, discounts, ratings, and customer counts are rejected in unrestricted headline/CTA fields. The renderer uses complete approved offer copy. All research edits invalidate the pending brief and require fresh approval; finished variants retain their historical snapshots. Brand overrides survive refresh. `adoptBrandContext` reuses company observations across owner-scoped campaigns without importing campaign selections; production repository wiring supplies `loadBrandResearch`.

The research panel shows the direction checkpoint, scoped product galleries, optional evidence, complete offer restrictions, unsorted candidates, owner corrections, and attempted-page coverage. The brand panel distinguishes observations/inferences/user changes and explicitly discloses the bundled Geist font substitution. Semantic palette roles feed render tokens. Pinned photo/logo bytes and production persistence are provided by the Supabase integration.

## Verification on 2026-09-22

Ten successful live Firecrawl calls: one homepage and one observed product URL for each store below. No fal calls were needed for these research checks. Homepage requests took about 9–12 seconds; product requests 4–6 seconds. These are retrieval/parser checks, not claims of five finished ads or deployment verification.

| Store | Product | Accepted structured references | Explicit variants |
| --- | --- | ---: | ---: |
| Loopy Cases | Brown Gingham | 1 | 27 |
| BlendJet | BlendJet 2 URL redirects to Best of BlendJet Bundle | 41 | 7 |
| Allbirds | Men's Runner NZ Slip On, Mushroom | 1 | 13 |
| Peak Design | SlimLink Case for iPhone | 1 | 0 |
| Ugmonk | Analog Daily Focus Kit, Walnut | 1 | 0 |

A separate live vision smoke check loaded three Loopy source images and completed one classification call with no warnings. It retained eligibility for the structurally owned product, kept a visually similar but unassociated photo ineligible, and marked an abstract image uncertain. This checks conservative control behavior, not universal classifier precision.

Trimmed source snapshots in `tests/fixtures/research-five-stores.json` make extraction regression checks repeatable. The BlendJet case exposed multiple variant-specific JSON-LD nodes without top-level URLs; offer URLs now establish identity and retain individual gallery associations. Allbirds exposed other-color variants inside a family node; only variants belonging to the current product path remain associated. Large Loopy/Allbirds/Ugmonk pages exposed a truncation issue, fixed by retaining complete structured scripts first. Tests also cover homepage zero-product-scrape behavior, persisted scope guards, unsupported IDs, other-product photos, optional extraction failures, user override retention, and source schema validation.

## Deliberate conservative limits

- The initial automatic gallery parser supports schema.org Product/ProductGroup and explicit Offer variant identities. Arbitrary embedded Shopify objects and DOM-only gallery layouts remain unresolved. One structured photo may be available even when the store has a much larger gallery.
- Browser-action gallery fallback remains unsupported. Unstructured photos do not gain eligibility from the vision role classification or model confidence. Oversized/unavailable images skip optional classification and remain inspectable. The owner can explicitly assign a known product photo; exact variant assignment still requires structured association.
- Inline SVG data-URL logos are not promoted to remote downloadable assets. BlendJet and Allbirds may therefore proceed without a logo. Remote logo candidates use the shared safe download/conversion boundary.
- Ratings are extracted only when attached to the same structured product record. Testimonials, customer-count synthesis, external review searches, broad catalog imports, and specialized trust-badge rendering remain unsupported. Their absence never blocks an evergreen ad.
- Natural-language scope recognition deliberately abstains on negation, hypothetical questions, and vague replies. A direct product URL or explicit “Promote …” input is the reliable path. Same-host redirects are retained; cross-host aliases require a separate supported identity flow.
- Source evidence is an observation, not a guarantee of current inventory, shopper eligibility, product accuracy, or generated-image fidelity. Final photo/brief approval and final ad review remain required.
