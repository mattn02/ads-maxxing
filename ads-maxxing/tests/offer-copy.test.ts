import assert from "node:assert/strict";
import { test } from "node:test";
import { plainOffer } from "../lib/workflow/creative/offer-copy";

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
