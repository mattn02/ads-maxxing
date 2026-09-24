import assert from "node:assert/strict";
import { test } from "node:test";
import { hasEvidence, research } from "../lib/workflow/agents/researcher";
import { readFile } from "node:fs/promises";
import { normalizeScrape, snapshotHtml } from "../lib/workflow/firecrawl";
import { extractSource, assetKey, canonicalUrl, pageHint } from "../lib/workflow/research/extract";
import { userResearchIntent } from "../lib/workflow/research/intent";
import { parseResearchSnapshot } from "../lib/workflow/research/persistence-schema";
import { groundBrief } from "../lib/workflow/research/grounding";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import type { Session, Source } from "../lib/workflow/session-types";
import { productResearch } from "./research-fixture";
import { MAX_RESEARCH_ASSETS } from "../lib/workflow/research/limits";

const home = "https://store.example/";
const productUrl = `${home}products/case`;
const photo = `${home}cdn/case.jpg?v=4&width=800`;
const source = (url = home, node?: object): Source => ({ url, title: "Fixture", description: "Useful cases", markdown: "20% off selected styles for first orders.", fetchedAt: new Date().toISOString(), colors: { background: "#ffffff", primary: "#336699" }, images: [photo, `${home}logo.png`, `${home}shipping.svg`], links: [`${home}pages/about`, productUrl, `${home}collections/summer`], branding: { images: { logo: `${home}logo.png` }, typography: { fontFamilies: { heading: "Example Sans" } } }, rawHtml: node ? `<script type="application/ld+json">${JSON.stringify(node)}</script>` : "" });
const node = { "@type": "Product", name: "Case", url: productUrl, image: [photo], sku: "case-1", offers: { price: "29", priceCurrency: "USD" }, aggregateRating: { ratingValue: "4.8", ratingCount: 40, reviewCount: 12 } };
const deps = (calls: string[]) => ({ scrape: async (url: string) => { calls.push(url); return source(url, url === productUrl ? node : undefined); }, discover: async () => [], synthesize: async () => ({ voice: "Friendly", audience: "Phone owners", sales: [] }), now: Date.now });
const input = (url = home) => ({ url, productUrl: null, campaignUrl: null });
const brief = (result: ReturnType<typeof productResearch>) => ({ productId: result.products![0].id, referenceAssetId: result.assets!.find(asset => asset.eligibleAsProductReference)!.id, productUrl, referenceImage: photo, headline: "Better grip", cta: "Shop now", direction: "Evergreen", saleId: null, parentVariantId: null, feedback: "" });
function workflowFixture() {
  const session: Session = { id: "test", createdAt: "now", updatedAt: "now", messages: [], events: [], preferences: {}, variants: [] };
  const calls: string[] = []; const snapshots: Session[] = [];
  const dependency: WorkflowDependencies = { research: (input, options) => research(input, options, deps(calls)), save: async session => { snapshots.push(structuredClone(session)); }, readVisual: async () => null, createAd: async () => { throw new Error("Should never generate"); }, reviewAd: async () => { throw new Error("Should never review"); } };
  return { workflow: new Workflow(session, dependency), session, calls, snapshots };
}

test("homepage-only stage saves reusable branding and never follows a product link", async () => {
  const calls: string[] = []; const checkpoints: string[] = [];
  const result = await research(input(), { checkpoint: async result => { checkpoints.push(result.id); } }, deps(calls));
  assert.ok(calls.every(url => !url.includes("/products/") && !url.includes("/collections/")));
  assert.equal(result.campaign?.status, "awaiting_direction"); assert.equal(result.products?.length, 0);
  assert.ok(result.suggestions!.length); assert.equal(result.brandKit?.typography.heading.value, "Example Sans");
  assert.equal(result.assets!.filter(asset => asset.eligibleAsProductReference).length, 0);
  assert.equal(checkpoints.length, 1); assert.notEqual(checkpoints[0], result.id);
  assert.equal(parseResearchSnapshot(result, 2).schemaVersion, 2);
});

test("research produces clean offer display fields before persistence and retains exact evidence", async () => {
  const quote = "###### Use code **PROTECT** to get **25% off** camera and/or screen tempered glass **with a Loopy Case purchase.**";
  const expected = "Use code PROTECT to get 25% off camera and/or screen tempered glass with a Loopy Case purchase.";
  const result = await research(input(), {}, {
    ...deps([]),
    scrape: async (url: string) => ({ ...source(url), markdown: quote }),
    synthesize: async () => ({ voice: "Friendly", audience: "Phone owners", sales: [{ sourceUrl: home, quote, description: quote }] }),
  });
  assert.equal(result.sales[0].description, expected);
  assert.equal(result.offers![0].displayCopy, expected);
  assert.equal(result.offers![0].restrictions, expected);
  assert.equal(result.sales[0].quote, quote);
  assert.equal(result.offers![0].quote, quote);
  assert.equal(result.offers![0].eligibility, "unresolved");
  assert.equal(hasEvidence(result.sales[0], result.sources), true);
  assert.deepEqual(parseResearchSnapshot(result, 2).offers, result.offers);
});

test("direct product scope gets missing brand context, structured product, and exact gallery", async () => {
  const calls: string[] = [];
  const result = await research(input(productUrl), { direction: { text: productUrl, origin: "specific_url", url: productUrl } }, deps(calls));
  assert.deepEqual(calls, [home, productUrl]);
  assert.equal(result.campaign?.status, "ready_for_brief"); assert.equal(result.products!.length, 1);
  assert.equal(result.products![0].price?.amount, 29);
  assert.equal(result.assets!.filter(asset => asset.eligibleAsProductReference).length, 1);
  assert.equal(result.customerEvidence![0].ratingCount, 40); assert.equal(result.customerEvidence![0].reviewCount, 12);
  groundBrief(brief(result), result);
});

test("page types treat locale home, About, tracking and unknown paths conservatively", () => {
  assert.equal(pageHint("https://store.example/en-us/?utm_source=ad"), "home");
  assert.equal(pageHint("https://store.example/pages/about-us"), "company");
  assert.equal(pageHint("https://store.example/unfamiliar"), "unknown");
  assert.equal(canonicalUrl(`${productUrl}?variant=12&utm_source=x`), `${productUrl}?variant=12`);
  assert.equal(assetKey(photo), `${home}cdn/case.jpg?v=4`);
});

test("JSON-LD recommendation nodes, logos and loose images cannot claim main product ownership", () => {
  const result = extractSource(source(productUrl, { "@graph": [node, { ...node, url: `${home}products/other`, image: [`${home}other.jpg`] }] }));
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.assets.filter(asset => asset.eligibleAsProductReference).map(asset => asset.originalUrl), [photo]);
  assert.equal(result.assets.find(asset => asset.originalUrl.endsWith("shipping.svg"))?.role, "unknown");
  assert.equal(result.assets.find(asset => asset.originalUrl.endsWith("logo.png"))?.eligibleAsProductReference, false);
});

test("actual input intent abstains for negation and hypotheses; UI generation refusal leaves research authorized", () => {
  for (const text of ["Maybe promote summer", "Do not research https://store.example/products/case", "What if we advertised this https://store.example/products/case?", "Promote it", "Choose that"]) assert.equal(userResearchIntent(text).direction, undefined, text);
  assert.equal(userResearchIntent(`Research ${productUrl}. Do not generate an ad.`).direction?.origin, "specific_url");
  assert.equal(userResearchIntent("Research store.example. Ask me what to promote before preparing any brief. Do not generate an ad.").direction, undefined);
  assert.deepEqual(userResearchIntent("Research loopycases.com").urls, ["https://loopycases.com/"]);
  assert.equal(userResearchIntent("Promote the summer collection").direction?.origin, "user_message");
});

test("invented tool direction and URLs cannot bypass persisted awaiting_direction after reload", async () => {
  const { workflow, session, calls, snapshots } = workflowFixture();
  workflow.setUserInput(`Research ${home}. Do not generate an ad.`, "first");
  await workflow.research(input()); const before = calls.length;
  const reloaded = structuredClone(session); assert.equal(reloaded.researchState?.stage, "awaiting_direction");
  workflow.setUserInput("Looks good", "next");
  await assert.rejects(workflow.research({ ...input(), direction: "promote summer" }), /explicitly/);
  await assert.rejects(workflow.research(input(productUrl)), /current message/);
  await assert.rejects(workflow.proposeBrief({ productUrl, referenceImage: photo, headline: "Hello", cta: "Shop", direction: "Evergreen", saleId: null, parentVariantId: null, feedback: "" }), /direction/);
  assert.equal(calls.length, before);
  assert.ok(snapshots.some(snapshot => snapshot.researchState?.stage === "awaiting_direction"));
});

test("explicit suggestion click supplies scope and product selection gates multi-product collections", async () => {
  const calls: string[] = [];
  const brand = await research(input(), {}, deps(calls));
  const choice = brand.suggestions!.find(choice => choice.url === productUrl)!;
  const intent = userResearchIntent(`[direction:${choice.id}] Research this direction`, "choice", brand);
  assert.equal(intent.direction?.origin, "choice");
  const result = await research(input(), { previous: brand, direction: intent.direction }, deps(calls));
  assert.equal(result.brandKit?.id, brand.brandKit?.id); assert.equal(result.campaign?.selectedProductId, result.products![0].id);
});

test("collection suggestions always wait for the user to choose a researched product", async () => {
  const calls: string[] = [];
  const brand = await research(input(), {}, deps(calls));
  const choice = brand.suggestions!.find(choice => choice.url.includes("/collections/"))!;
  const result = await research(input(), { previous: brand, direction: { text: choice.label, origin: "choice", choiceId: choice.id, url: choice.url } }, deps(calls));
  assert.equal(result.products!.length, 1);
  assert.equal(result.campaign?.status, "needs_selection");
  assert.equal(result.campaign?.selectedProductId, null);
});

test("missing optional synthesis keeps source facts and immutable checkpoint", async () => {
  const calls: string[] = [];
  const result = await research(input(productUrl), { direction: { text: productUrl, origin: "specific_url", url: productUrl } }, { ...deps(calls), synthesize: async () => { throw new Error("Model unavailable"); } });
  assert.equal(result.products!.length, 1); assert.match(result.warnings.join(" "), /unavailable/); groundBrief(brief(result), result);
});

test("cross-product, wrong-variant, unresolved offer, copy claim and legacy drafts fail grounding", () => {
  const result = productResearch(source(productUrl, node)); const draft = brief(result);
  assert.throws(() => groundBrief({ ...draft, referenceAssetId: "missing" }, result), /Unknown/);
  assert.throws(() => groundBrief({ ...draft, variantId: "not-known" }, result), /variant/);
  assert.throws(() => groundBrief({ ...draft, saleId: "unresolved" }, result), /eligibility/);
  assert.throws(() => groundBrief({ ...draft, headline: "20% off everything" }, result), /supported claim/);
  assert.throws(() => groundBrief(draft, { ...result, schemaVersion: undefined }), /legacy/);
  result.assets![0].productIds = ["other"];
  assert.throws(() => groundBrief(draft, result), /selected product/);
});

test("schema column is authoritative, unknown versions and invalid V2 payloads fail", async () => {
  const result = await research(input(), {}, deps([]));
  assert.throws(() => parseResearchSnapshot(result, 1), /disagree/);
  assert.throws(() => parseResearchSnapshot(result, 99), /unsupported/);
  assert.throws(() => parseResearchSnapshot({ ...result, assets: [{ id: "bad" }] }, 2), /invalid/);
});

test("retrieval keeps complete branding, final URL, relative images and structured HTML", () => {
  const result = normalizeScrape(home, { data: { metadata: { url: home, title: "Brand" }, images: ["/photo.jpg", "/photo.jpg"], rawHtml: "<html>source</html>", links: ["/products/case"], branding: { colors: { accent: "#abcdff" }, typography: { fontFamily: "Store Font" }, images: { logo: "/logo.svg" } } } });
  assert.deepEqual(result.images, [`${home}photo.jpg`]); assert.equal(result.colors.accent, "#abcdff"); assert.equal(result.rawHtml, "<html>source</html>"); assert.ok(result.branding?.typography);
});

test("scraping and saved research cap assets while retaining logos and valid product references", async () => {
  const imageUrls = Array.from({ length: 75 }, (_, index) => `${home}cdn/case-${index}.jpg`);
  const normalized = normalizeScrape(home, { data: { metadata: { url: home }, images: imageUrls } });
  assert.equal(normalized.images.length, MAX_RESEARCH_ASSETS);

  const manyImages = { ...node, image: imageUrls };
  const result = await research(input(productUrl), { direction: { text: productUrl, origin: "specific_url", url: productUrl } }, {
    ...deps([]),
    scrape: async url => source(url, url === productUrl ? manyImages : undefined),
  });
  assert.equal(result.assets!.length, MAX_RESEARCH_ASSETS);
  assert.ok(result.assets!.some(asset => asset.role === "logo"));
  assert.ok(result.assets!.some(asset => asset.eligibleAsProductReference));
  assert.ok(result.brandKit!.logoAssetIds.every(id => result.assets!.some(asset => asset.id === id)));
  assert.ok(result.products![0].assetIds.every(id => result.assets!.some(asset => asset.id === id)));
  assert.ok(result.products![0].variants.every(variant => variant.assetIds.every(id => result.assets!.some(asset => asset.id === id))));
  assert.match(result.warnings.join(" "), /40 most relevant assets/);
});


test("large storefront snapshots retain structured data after runtime bundles", () => {
  const script = `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
  const html = snapshotHtml("x".repeat(900000) + script);
  assert.ok(html.length <= 800000); assert.ok(html.includes(script));
});

test("five live store snapshots preserve product identities, variant ownership and CDN resolution", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/research-five-stores.json", import.meta.url), "utf8")) as { store: string; source: Source; expected: { products: number; eligible: number; variants: number } }[];
  const expected: Record<string, [number, number]> = { "www.loopycases.com": [1, 27], "blendjet.com": [41, 7], "www.allbirds.com": [1, 13], "www.peakdesign.com": [1, 0], "ugmonk.com": [1, 0] };
  for (const fixture of fixtures) {
    const result = extractSource(fixture.source);
    assert.equal(result.products.length, 1, fixture.store);
    assert.equal(result.assets.filter(asset => asset.eligibleAsProductReference).length, expected[fixture.store][0], fixture.store);
    assert.equal(result.products[0].variants.length, expected[fixture.store][1], fixture.store);
    for (const asset of result.assets.filter(asset => asset.eligibleAsProductReference)) assert.deepEqual(asset.productIds, [result.products[0].id]);
    if (fixture.store === "www.allbirds.com") assert.ok(Number(new URL(result.assets.find(asset => asset.eligibleAsProductReference)!.originalUrl).searchParams.get("width")) >= 900);
    if (fixture.store === "blendjet.com") assert.ok(result.assets.filter(asset => asset.eligibleAsProductReference).every(asset => asset.variantIds.length === 1), "Each BlendJet variant's gallery stays assigned to that variant");
  }
});

test("owner corrections survive refresh and every research edit revokes pending approval", async () => {
  const { workflow, session } = workflowFixture();
  workflow.setUserInput(`Research ${productUrl}`); await workflow.research(input(productUrl));
  await workflow.correctBrand("voice", "Concise and practical");
  const historical = structuredClone(session.research!);
  workflow.setUserInput(`Research ${home}`); await workflow.research(input());
  assert.equal(session.research!.voice, "Concise and practical");
  assert.equal(historical.brandKit!.overrides.voice, "Concise and practical");
  assert.notEqual(session.research!.id, historical.id);
});

test("assigned unsorted photos retain product membership through refresh", async () => {
  const { workflow, session } = workflowFixture();
  workflow.setUserInput(`Research ${productUrl}`); await workflow.research(input(productUrl));
  const candidate = session.research!.assets!.find(asset => asset.originalUrl.endsWith("shipping.svg"))!;
  const productId = session.research!.products![0].id;
  await workflow.correctAsset(candidate.id, "product_photo", productId);
  await workflow.research(input(productUrl));
  const corrected = session.research!.assets!.find(asset => asset.id === candidate.id)!;
  assert.equal(corrected.classification, "user_confirmed");
  assert.ok(session.research!.products![0].assetIds.includes(candidate.id));
});

test("optional synthesis failure leaves saved research and a visible stage diagnostic", async () => {
  const events: import("../lib/workflow/diagnostics").Progress[] = [];
  let checkpointed = false;
  const result = await research(input(), {
    progress: async event => { events.push(event); },
    checkpoint: async () => { checkpointed = true; },
  }, { ...deps([]), synthesize: async () => { throw new Error("hidden payload", { cause: { statusCode: 429 } }); } });
  assert.ok(checkpointed);
  assert.ok(result.sources.length > 0);
  const failure = events.find(event => event.action === "research:synthesis" && event.status === "failed");
  assert.match(failure?.detail || "", /request limit.*reference/);
  assert.ok(result.warnings.some(warning => warning.includes(failure!.detail)));
  assert.doesNotMatch(JSON.stringify(events), /hidden payload/);
});

test("Shopify collection product links match canonical structured product identity", () => {
  const alias = `${home}collections/summer/products/case`;
  const result = extractSource(source(alias, node));
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].title, "Case");
  assert.ok(result.assets.some(asset => asset.eligibleAsProductReference));
  const recommendation = extractSource(source(alias, { ...node, url: `${home}products/other` }));
  assert.equal(recommendation.products.length, 0);
});
