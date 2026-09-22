import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { research } from "../lib/workflow/agents/researcher";
import { researchBrand } from "../lib/workflow/onboarding";
import {
  adoptBrandContext,
  effectiveBrandResearch,
} from "../lib/workflow/research/brand-context";
import { userResearchIntent } from "../lib/workflow/research/intent";
import { normalizeStoreInput } from "../lib/workflow/onboarding-contracts";
import { campaignOpening } from "../lib/workflow/brands";
import { publicSession } from "../lib/workflow/public-session";
import type { Session, Source } from "../lib/workflow/session-types";
const home = "https://store.example/";
const source = (url: string): Source => ({
  url,
  title: "Example",
  description: "Useful cases",
  images: [`${home}logo.png`],
  markdown: "Useful cases",
  colors: { primary: "#112233" },
  fetchedAt: new Date().toISOString(),
  branding: { images: { logo: `${home}logo.png` } },
  links: [
    `${home}pages/about`,
    ...Array.from(
      { length: 8 },
      (_, i) => `${home}collections/collection-${i}`,
    ),
  ],
});
const dependencies = () => {
  const calls: string[] = [];
  return {
    calls,
    scrape: async (url: string) => {
      calls.push(url);
      return source(url);
    },
    synthesize: async () => ({
      voice: "Friendly",
      audience: "Phone owners",
      sales: [],
    }),
    discover: async () => {
      throw new Error("Must not discover during setup");
    },
    classify: async () => {
      throw new Error("Must not classify during setup");
    },
    now: Date.now,
  };
};
const fixture = (): Session => ({
  id: randomUUID(),
  purpose: "brand_setup",
  setup: {
    state: "needs_url",
    storeUrl: home,
    originalUrl: `${home}products/case?variant=3`,
  },
  createdAt: "now",
  updatedAt: "now",
  messages: [],
  events: [],
  preferences: {},
  variants: [],
});

test("setup normalizes product input to root and preserves useful original URL", () => {
  assert.deepEqual(
    normalizeStoreInput("shop.example.com/products/a?variant=2#photos"),
    {
      storeUrl: "https://shop.example.com/",
      originalUrl: "https://shop.example.com/products/a?variant=2",
    },
  );
  for (const url of [
    "https://name:password@store.example",
    "ftp://store.example",
    "localhost",
    "https://store.example:8080",
  ])
    assert.throws(() => normalizeStoreInput(url));
});
test("brand scope overrides product URLs and campaign arguments, retains links, never runs vision", async () => {
  const deps = dependencies();
  const result = await research(
    {
      url: `${home}products/case`,
      productUrl: `${home}products/case`,
      campaignUrl: null,
    },
    {
      scope: "brand",
      direction: {
        text: "Case",
        origin: "specific_url",
        url: `${home}products/case`,
      },
    },
    deps,
  );
  assert.deepEqual(deps.calls, [home, `${home}pages/about`]);
  assert.equal(result.products?.length, 0);
  assert.equal(result.discoveredLinks?.length, 8);
  assert.equal(result.suggestions?.length, 3);
  assert.equal(result.campaign?.direction, null);
});
test("interim checkpoints stay researching; only terminal save is ready; same operation never repeats", async () => {
  const session = fixture();
  const states: Session[] = [];
  const deps = dependencies();
  const actions = {
    research: (
      input: Parameters<typeof research>[0],
      options: Parameters<typeof research>[1],
    ) => research(input, options, deps),
    save: async (value: Session) => {
      states.push(structuredClone(value));
    },
  };
  const op = randomUUID();
  await researchBrand(session, op, actions);
  assert.ok(
    states.some((item) => item.research && item.setup?.state === "researching"),
  );
  assert.equal(
    states.filter((item) => item.setup?.state === "ready").length,
    1,
  );
  assert.equal(states.at(-1)?.setup?.state, "ready");
  assert.equal(
    session.research?.suggestions?.[0].url,
    session.setup?.originalUrl,
  );
  const count = deps.calls.length;
  await researchBrand(session, op, actions);
  assert.equal(deps.calls.length, count);
});
test("total retrieval failure persists recovery and a new explicit operation can retry", async () => {
  const session = fixture();
  const deps = dependencies();
  const save = async () => {};
  const op = randomUUID();
  await assert.rejects(
    researchBrand(session, op, {
      save,
      research: (input, options) =>
        research(input, options, {
          ...deps,
          scrape: async () => {
            throw new Error("Unavailable");
          },
        }),
    }),
    /No pages/,
  );
  assert.equal(session.setup?.state, "failed");
  await researchBrand(session, op, {
    save,
    research: async () => {
      throw new Error("Should not replay");
    },
  });
  await researchBrand(session, randomUUID(), {
    save,
    research: (input, options) => research(input, options, deps),
  });
  assert.equal(session.setup?.state, "ready");
});
test("missing optional synthesis remains usable and campaign starts isolate products, offers and snapshot IDs", async () => {
  const deps = dependencies();
  const saved = await research(
    { url: home, productUrl: null, campaignUrl: null },
    { scope: "brand" },
    {
      ...deps,
      synthesize: async () => {
        throw new Error("Unavailable");
      },
    },
  );
  saved.brandKit!.overrides = {
    name: "Corrected",
    voice: "Concise",
    audience: "Commuters",
  };
  saved.brandKit!.visualOverrides = {
    colors: [{ role: "primary", value: "#aabbcc" }],
    selectedLogoAssetId: null,
  };
  const snapshot = structuredClone(saved);
  const next = adoptBrandContext(saved);
  assert.notEqual(next.id, saved.id);
  assert.deepEqual(next.products, []);
  assert.deepEqual(next.offers, []);
  assert.deepEqual(next.sales, []);
  assert.equal(next.campaign?.selectedProductId, null);
  assert.equal(next.voice, "Concise");
  assert.equal(next.brandKit?.name, "Corrected");
  assert.equal(next.brandKit?.selectedLogoAssetId, null);
  assert.equal(next.colors[0].value, "#aabbcc");
  assert.deepEqual(saved, snapshot);
  assert.equal(effectiveBrandResearch(saved).brandKit?.name, "Corrected");
  assert.match(JSON.stringify(campaignOpening(next)), /Corrected/);
  const empty = structuredClone(next);
  empty.suggestions = [];
  assert.match(
    JSON.stringify(campaignOpening(empty)),
    /paste a product or collection URL/,
  );
});
test("natural choice replies authorize only a displayed choice; questions and stale IDs do not", async () => {
  const saved = await research(
    { url: home, productUrl: null, campaignUrl: null },
    { scope: "brand" },
    dependencies(),
  );
  assert.equal(
    userResearchIntent("The second one", "reply", saved).direction?.url,
    saved.suggestions?.[1].url,
  );
  assert.equal(
    userResearchIntent("Let's do collection 0", "reply", saved).direction?.url,
    saved.suggestions?.[0].url,
  );
  for (const message of [
    "Maybe collection 0",
    "What about the first one?",
    "Can you research https://store.example/products/case?",
    "[direction:foreign] https://store.example/products/case",
    "[direction:foreign-choice] https://store.example/products/case",
  ])
    assert.equal(
      userResearchIntent(message, "reply", saved).direction,
      undefined,
    );
  assert.ok(
    userResearchIntent(
      "https://store.example/products/case?variant=3",
      "reply",
      saved,
    ).direction,
  );
});
test("public recovery state reflects lease expiration without exposing a lease token", () => {
  const session = fixture();
  session.leaseExpiresAt = new Date(Date.now() + 30000).toISOString();
  assert.equal(publicSession(session).operationActive, true);
  session.leaseExpiresAt = new Date(0).toISOString();
  assert.equal(publicSession(session).operationActive, false);
});
