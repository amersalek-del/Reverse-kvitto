import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVouchers } from "../src/core/accounting.ts";
import { defaultSettings } from "../src/core/defaults.ts";
import type { Report } from "../src/core/model.ts";
import { kr } from "../src/core/money.ts";
import { buildPayrollLines } from "../src/core/payroll.ts";
import { summarizeReport } from "../src/core/report.ts";
import { encodeCp437, toSie } from "../src/core/sie.ts";

function report(): Report {
  return {
    id: "r1",
    employeeId: "anna",
    title: "Berlin",
    status: "approved",
    approvals: [],
    history: [],
    createdAt: "2026-09-20T10:00:00Z",
    entries: [
      { id: "e1", kind: "receipt", date: "2026-09-14", merchant: "Hotel Adlon", description: "2 nätter", categoryId: "lodging", currency: "EUR", amount: kr(378), exchangeRate: 11.2, vatRate: 0, payment: "private", attachmentIds: [] },
      { id: "e2", kind: "receipt", date: "2026-09-13", merchant: "SJ", description: "", categoryId: "travel", currency: "SEK", amount: kr(549), exchangeRate: 1, vatRate: 6, payment: "company_card", attachmentIds: [], costCenter: "KS1" },
      { id: "e3", kind: "trip", purpose: "Mässa", destination: "Berlin", trip: { departure: "2026-09-14T06:30", return: "2026-09-16T18:00", country: "DE" } },
      { id: "e4", kind: "mileage", date: "2026-09-14", from: "Hem", to: "Arlanda", purpose: "Flyg", km: 40, vehicle: "own_car", companyRatePerMil: kr(30) },
    ],
  };
}

test("foreign receipts are booked gross on the foreign account without VAT", () => {
  const settings = defaultSettings();
  const summary = summarizeReport(report(), settings);
  const [voucher] = buildVouchers(report(), summary, "Anna", settings);
  assert.deepEqual(voucher!.rows.find((r) => r.account === "5832"), { account: "5832", debit: kr(4233.6), credit: 0, text: "Hotel Adlon 2 nätter" });
  assert.deepEqual(voucher!.rows.find((r) => r.account === "2641"), { account: "2641", debit: kr(31.08), credit: 0, text: "SJ" });
  assert.deepEqual(voucher!.rows.find((r) => r.account === "2890"), { account: "2890", debit: 0, credit: kr(549), text: "SJ" });
  assert.equal(voucher!.rows.find((r) => r.account === "5810")!.costCenter, "KS1");
  // Allowances go through payroll by default, so they are not on the expense voucher.
  assert.equal(voucher!.rows.some((r) => r.account.startsWith("73")), false);
});

test("per-entry mode with allowances booked in bookkeeping", () => {
  const settings = { ...defaultSettings(), voucherMode: "per_entry" as const, allowancesTo: "bookkeeping" as const };
  const summary = summarizeReport(report(), settings);
  const vouchers = buildVouchers(report(), summary, "Anna", settings);
  assert.deepEqual(vouchers.map((v) => [v.transactionDate, v.entryIds[0]]), [
    ["2026-09-14", "e1"],
    ["2026-09-13", "e2"],
    ["2026-09-16", "e3"],
    ["2026-09-14", "e4"],
  ]);
  assert.deepEqual(vouchers[2]!.rows, [
    { account: "7323", debit: kr(760 + 760 + 380), credit: 0 },
    { account: "2822", debit: 0, credit: kr(1900) },
  ]);
  assert.deepEqual(vouchers[3]!.rows, [
    { account: "7331", debit: kr(100), credit: 0 },
    { account: "7332", debit: kr(20), credit: 0 },
    { account: "2822", debit: 0, credit: kr(120) },
  ]);
});

test("payroll lines split tax-free and taxable mileage", () => {
  const settings = defaultSettings();
  const lines = buildPayrollLines({ id: "anna", name: "Anna", employeeNumber: "7", role: "employee" }, summarizeReport(report(), settings), settings);
  assert.deepEqual(
    lines.map((l) => [l.salaryCode, l.quantity, l.rate, l.amount]),
    [
      ["UTLAGG", 1, kr(4233.6), kr(4233.6)],
      ["TRAKT_UTR", 1, kr(1900), kr(1900)],
      ["BIL_SKFRI", 4, kr(25), kr(100)],
      ["BIL_SKPL", 4, kr(5), kr(20)],
    ],
  );
});

test("SIE export uses PC8 encoding and signed amounts", () => {
  const settings = defaultSettings();
  const vouchers = buildVouchers(report(), summarizeReport(report(), settings), "Anna", settings);
  const sie = toSie(vouchers, { companyName: "Åkeri AB", organisationNumber: "556677-8899", generatedOn: "2026-09-20", accountNames: { "2822": "Reseräkningar" } });
  assert.match(sie, /#FNAMN "Åkeri AB"/);
  assert.match(sie, /#TRANS 2890 \{\} -549\.00 "" "SJ"/);
  assert.match(sie, /#TRANS 5810 \{1 "KS1"\} 517\.92/);
  const bytes = encodeCp437("Åäö");
  assert.deepEqual([...bytes], [0x8f, 0x84, 0x94]);
});
