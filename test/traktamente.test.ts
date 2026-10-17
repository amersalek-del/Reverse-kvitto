import assert from "node:assert/strict";
import { test } from "node:test";
import { kr } from "../src/core/money.ts";
import { calculatePerDiem } from "../src/core/traktamente.ts";

test("domestic trip: departure before noon and return after 19 gives full days", () => {
  const r = calculatePerDiem({ departure: "2026-03-02T07:00", return: "2026-03-04T20:00", country: "SE", distanceKm: 120 });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.days.map((d) => d.kind), ["full", "full", "full"]);
  assert.equal(r.total, kr(900));
});

test("domestic trip: departure at 12:00 and return at 19:00 are half days", () => {
  const r = calculatePerDiem({ departure: "2026-03-02T12:00", return: "2026-03-04T19:00", country: "SE" });
  assert.deepEqual(r.days.map((d) => d.kind), ["half", "full", "half"]);
  assert.equal(r.total, kr(150 + 300 + 150));
});

test("day trips and short distances are not tax-free", () => {
  const dayTrip = calculatePerDiem({ departure: "2026-03-02T06:00", return: "2026-03-02T22:00", country: "SE" });
  assert.equal(dayTrip.eligible, false);
  assert.equal(dayTrip.total, 0);
  const near = calculatePerDiem({ departure: "2026-03-02T06:00", return: "2026-03-03T22:00", country: "SE", distanceKm: 50 });
  assert.equal(near.eligible, false);
});

test("domestic meal reductions follow Skatteverket's table", () => {
  const r = calculatePerDiem({
    departure: "2026-05-04T07:00",
    return: "2026-05-08T12:00",
    country: "SE",
    freeMeals: {
      "2026-05-04": { breakfast: true },
      "2026-05-05": { lunch: true, dinner: true },
      "2026-05-06": { breakfast: true, lunch: true, dinner: true },
      "2026-05-07": { dinner: true },
      "2026-05-08": { lunch: true },
    },
  });
  assert.deepEqual(
    r.days.map((d) => d.mealReduction / 100),
    [60, 210, 270, 105, 53],
  );
  assert.deepEqual(
    r.days.map((d) => d.amount / 100),
    [240, 90, 30, 195, 97],
  );
});

test("long-term stays drop to 70 % after three months and 50 % after two years", () => {
  const after3 = calculatePerDiem({
    departure: "2026-06-01T07:00",
    return: "2026-06-02T20:00",
    country: "SE",
    sameLocationSince: "2026-02-15",
    freeMeals: { "2026-06-01": { lunch: true } },
  });
  assert.equal(after3.days[0]!.maxAmount, kr(210));
  assert.equal(after3.days[0]!.mealReduction, kr(74));
  const after2y = calculatePerDiem({ departure: "2026-06-01T07:00", return: "2026-06-02T20:00", country: "SE", sameLocationSince: "2024-05-01" });
  assert.equal(after2y.days[0]!.maxAmount, kr(150));
});

test("night allowance only for claimed nights", () => {
  const r = calculatePerDiem({ departure: "2026-03-02T07:00", return: "2026-03-05T20:00", country: "SE", nightAllowance: ["2026-03-03"] });
  assert.deepEqual(r.nights.map((n) => [n.date, n.amount]), [["2026-03-03", kr(150)]]);
  const all = calculatePerDiem({ departure: "2026-03-02T07:00", return: "2026-03-05T20:00", country: "SE", nightAllowance: "all" });
  assert.equal(all.nights.length, 3);
});

test("foreign trip uses the country's normalbelopp and foreign meal percentages", () => {
  const r = calculatePerDiem({
    departure: "2026-09-14T06:30",
    return: "2026-09-16T18:00",
    country: "DE",
    freeMeals: { "2026-09-15": { breakfast: true, lunch: true, dinner: true } },
    nightAllowance: ["2026-09-14"],
  });
  assert.deepEqual(r.days.map((d) => [d.kind, d.maxAmount / 100, d.amount / 100]), [
    ["full", 760, 760],
    ["full", 760, 114],
    ["half", 380, 380],
  ]);
  assert.equal(r.nights[0]!.amount, kr(380));
  assert.equal(r.foreignTotal, kr(760 + 114 + 380 + 380));
  assert.equal(r.domesticTotal, 0);
});

test("per-day countries split domestic and foreign amounts; unknown countries use the fallback", () => {
  const r = calculatePerDiem({
    departure: "2026-09-14T06:30",
    return: "2026-09-15T21:00",
    country: "XX",
    dayCountries: { "2026-09-14": "SE" },
  });
  assert.equal(r.domesticTotal, kr(300));
  assert.equal(r.foreignTotal, kr(470));
});

test("rejects a return before departure", () => {
  assert.throws(() => calculatePerDiem({ departure: "2026-03-02T07:00", return: "2026-03-01T20:00", country: "SE" }));
});
