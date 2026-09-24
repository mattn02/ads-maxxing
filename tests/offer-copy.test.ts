import assert from "node:assert/strict";
import { test } from "node:test";
import { plainOffer } from "../lib/workflow/research/offer-copy";
import { publicSession } from "../lib/workflow/public-session";
import type { Research, Session } from "../lib/workflow/session-types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferChoices } from "../components/workspace/offer-choices";

test("offer copy removes heading and emphasis while preserving commercial terms", () => {
  assert.equal(plainOffer("###### **Get Free** US Ground Advantage Shipping On Orders $55+"), "Get Free US Ground Advantage Shipping On Orders $55+");
  const expected = "Use code PROTECT to get 25% off camera and/or screen tempered glass with a Loopy Case purchase.";
  assert.equal(plainOffer("###### Use code **PROTECT** to get **25% off** camera and/or screen tempered glass **with a Loopy Case purchase.**"), expected);
  assert.equal(plainOffer(String.raw`###### Use code \*\*PROTECT\*\* to get \*\*25% off\*\* camera and/or screen tempered glass \*\*with a Loopy Case purchase.\*\*`), expected);
});

test("offer copy retains punctuation, literal asterisks, link labels, and paragraph boundaries", () => {
  assert.equal(plainOffer("Save 25%* on $55+ orders — code: CASE_25!"), "Save 25%* on $55+ orders — code: CASE_25!");
  assert.equal(plainOffer("**Save 25%.**\n\nWith a [Loopy Case](https://example.com) purchase."), "Save 25%. With a Loopy Case purchase.");
  assert.equal(plainOffer(String.raw`Save 25%\* with purchase.`), "Save 25%* with purchase.");
});

test("reloading old campaigns cleans current and historical offer display without changing saved state", () => {
  const quote = "###### **Get Free** US Ground Advantage Shipping On Orders $55+";
  const expected = "Get Free US Ground Advantage Shipping On Orders $55+";
  const research: Research = {
    id: "research", sources: [], colors: [], voice: "Friendly", audience: "Owners", warnings: [],
    sales: [{ id: "offer", sourceUrl: "https://loopycases.com", quote, description: quote }],
    offers: [{ id: "offer", sourceUrl: "https://loopycases.com", quote, displayCopy: quote, restrictions: "**US only.**", productIds: [], checkedAt: new Date().toISOString(), eligibility: "unresolved", endsAt: null }],
  };
  const session = { research, variants: [{ research, renderedCopy: { offer: quote } }] } as Session;
  const before = structuredClone(session);
  const projected = publicSession(session);
  for (const result of [projected.research!, projected.variants[0].research]) {
    assert.equal(result.sales[0].description, expected);
    assert.equal(result.offers![0].displayCopy, expected);
    assert.equal(result.offers![0].restrictions, "US only.");
    assert.equal(result.offers![0].quote, quote);
    assert.equal(result.sales[0].quote, quote);
    assert.equal(result.offers![0].id, "offer");
    assert.equal(result.offers![0].eligibility, "unresolved");
  }
  assert.equal(projected.variants[0].renderedCopy!.offer, quote);
  const html = renderToStaticMarkup(createElement(OfferChoices, {
    offers: projected.research!.offers!, name: "offers", saleId: "offer",
    setSaleId: () => {}, confirmed: false, setConfirmed: () => {}, busy: false, label: "Offers",
  }));
  assert.ok(html.includes(expected));
  assert.ok(html.includes(`Store wording: “${expected}”`));
  assert.ok(html.includes("Terms: US only."));
  assert.doesNotMatch(html, /######|\*\*/);
  assert.deepEqual(session, before);
  assert.deepEqual(publicSession(projected), projected);
});
