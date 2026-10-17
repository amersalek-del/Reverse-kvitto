import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CATEGORIES } from "../src/core/categories.ts";
import { kr } from "../src/core/money.ts";
import { isValidOrgNumber, parseReceiptText } from "../src/core/receipt-parser.ts";

test("parses a fuel receipt", () => {
  const text = `CIRCLE K BROMMA
Org.nr 556185-6468
Kvitto nr 4711
2026-10-12 14:33
Diesel  42,10 l  21,49 kr/l
                       904,73
ATT BETALA SEK         904,73
Moms%  Moms   Netto   Brutto
25,00  180,95 723,78  904,73
Kortköp VISA ****1234`;
  const r = parseReceiptText(text, DEFAULT_CATEGORIES);
  assert.equal(r.merchant, "CIRCLE K BROMMA");
  assert.equal(r.organisationNumber, "556185-6468");
  assert.equal(r.date, "2026-10-12");
  assert.equal(r.total, kr(904.73));
  assert.equal(r.currency, "SEK");
  assert.equal(r.vatRate, 25);
  assert.equal(r.vatTotal, kr(180.95));
  assert.equal(r.categoryId, "fuel");
});

test("parses a restaurant receipt with mixed VAT rates", () => {
  const text = `Restaurang Pelikan
Blekingegatan 40, Stockholm
17/10/2026
2 x Pytt i panna    398,00
2 x Starköl         178,00
Totalt              576,00
Moms 12%  42,64
Moms 25%  35,60`;
  const r = parseReceiptText(text, DEFAULT_CATEGORIES);
  assert.equal(r.date, "2026-10-17");
  assert.equal(r.total, kr(576));
  assert.deepEqual(r.vatLines.map((v) => [v.rate, v.vat]), [
    [12, kr(42.64)],
    [25, kr(35.6)],
  ]);
  assert.equal(r.vatRate, undefined);
  assert.equal(r.vatTotal, kr(78.24));
  assert.equal(r.categoryId, "rep_external");
});

test("detects foreign currency and falls back to the category VAT rate", () => {
  const r = parseReceiptText("Hotel Adlon Berlin\n14.09.2026\nTotal EUR 189,00", DEFAULT_CATEGORIES);
  assert.equal(r.currency, "EUR");
  assert.equal(r.total, kr(189));
  assert.equal(r.date, "2026-09-14");
  assert.equal(r.categoryId, "lodging");
});

test("validates organisation numbers with the Luhn checksum", () => {
  assert.equal(isValidOrgNumber("5561856468"), true);
  assert.equal(isValidOrgNumber("5561856467"), false);
});
