import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateMileage } from "../src/core/mileage.ts";
import { formatSek, kr, parseAmount, vatFromGross } from "../src/core/money.ts";
import { representationVat } from "../src/core/representation.ts";

test("parseAmount handles Swedish and English formats", () => {
  assert.equal(parseAmount("1 234,56"), 123456);
  assert.equal(parseAmount("1.234,56"), 123456);
  assert.equal(parseAmount("1,234.56"), 123456);
  assert.equal(parseAmount("99,90 kr"), 9990);
  assert.equal(parseAmount("abc"), null);
  assert.equal(formatSek(123456), "1 234,56");
});

test("vatFromGross splits VAT-inclusive amounts", () => {
  assert.deepEqual(vatFromGross(kr(125), 25), { net: kr(100), vat: kr(25) });
  assert.deepEqual(vatFromGross(kr(112), 12), { net: kr(100), vat: kr(12) });
  assert.deepEqual(vatFromGross(kr(106), 6), { net: kr(100), vat: kr(6) });
});

test("mileage: own car 25 kr/mil tax-free, excess taxable", () => {
  assert.deepEqual(calculateMileage({ date: "2026-04-01", km: 123, vehicle: "own_car" }), {
    mil: 12.3,
    taxFreeRatePerMil: kr(25),
    paidRatePerMil: kr(25),
    taxFree: kr(307.5),
    taxable: 0,
    total: kr(307.5),
  });
  const generous = calculateMileage({ date: "2026-04-01", km: 100, vehicle: "own_car", companyRatePerMil: kr(30) });
  assert.equal(generous.taxFree, kr(250));
  assert.equal(generous.taxable, kr(50));
  assert.equal(calculateMileage({ date: "2026-04-01", km: 100, vehicle: "company_car_electric" }).taxFree, kr(95));
  assert.equal(calculateMileage({ date: "2026-04-01", km: 100, vehicle: "company_car_fuel" }).taxFree, kr(120));
  assert.throws(() => calculateMileage({ date: "2026-04-01", km: 0, vehicle: "own_car" }));
});

test("representation: full VAT below 300 kr per person", () => {
  const r = representationVat({ date: "2026-05-01", kind: "meal_food_only", persons: 2, gross: kr(560), vat: kr(60) });
  assert.equal(r.deductibleVat, kr(60));
});

test("representation: capped at 36 kr per person for food only above the cap", () => {
  const r = representationVat({ date: "2026-05-01", kind: "meal_food_only", persons: 3, gross: kr(1680), vat: kr(180) });
  assert.equal(r.deductibleVat, kr(108));
  assert.equal(r.nonDeductibleVat, kr(72));
  assert.equal(r.costDeductible, false);
});

test("representation: flat 46 kr per person with alcohol above the cap", () => {
  const r = representationVat({ date: "2026-05-01", kind: "meal_with_alcohol", persons: 4, gross: kr(3000), vat: kr(450) });
  assert.equal(r.deductibleVat, kr(184));
});

test("representation: simple refreshments are fully deductible", () => {
  const r = representationVat({ date: "2026-05-01", kind: "simple_refreshments", persons: 10, gross: kr(560), vat: kr(60) });
  assert.equal(r.deductibleVat, kr(60));
  assert.equal(r.costDeductible, true);
});
