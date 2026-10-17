import { yearOf } from "./dates.ts";
import { type Ore } from "./money.ts";
import { ratesFor } from "./rates.ts";

// VAT on representation meals is deductible only on a base of at most 300 kr
// excluding VAT per person and occasion. Above the cap the deduction is
// 12 % of 300 kr (36 kr) for food only, or Skatteverket's flat 46 kr when alcohol
// is served. Simpler refreshments ("enklare förtäring", e.g. fika) are fully
// deductible.

export type RepresentationKind = "meal_food_only" | "meal_with_alcohol" | "simple_refreshments";

export interface RepresentationInput {
  date: string;
  kind: RepresentationKind;
  persons: number;
  /** Total paid including VAT. */
  gross: Ore;
  /** VAT shown on the receipt. */
  vat: Ore;
}

export interface RepresentationResult {
  deductibleVat: Ore;
  /** VAT that may not be deducted and is booked as cost. */
  nonDeductibleVat: Ore;
  /** Whether the cost itself is deductible for income tax. */
  costDeductible: boolean;
  note: string;
}

export function representationVat(input: RepresentationInput): RepresentationResult {
  if (!Number.isInteger(input.persons) || input.persons < 1) throw new Error("Antal deltagare måste anges");
  const rules = ratesFor(yearOf(input.date)).representation;

  if (input.kind === "simple_refreshments") {
    return { deductibleVat: input.vat, nonDeductibleVat: 0, costDeductible: true, note: "Enklare förtäring – full avdragsrätt" };
  }

  const netPerPerson = (input.gross - input.vat) / input.persons;
  if (netPerPerson <= rules.baseCapPerPerson) {
    return { deductibleVat: input.vat, nonDeductibleVat: 0, costDeductible: false, note: "Under 300 kr exkl. moms per person – full momsavdrag" };
  }

  const cap =
    input.kind === "meal_with_alcohol"
      ? rules.flatRateWithAlcoholPerPerson * input.persons
      : Math.round((rules.baseCapPerPerson * rules.restaurantVatPercent) / 100) * input.persons;
  const deductibleVat = Math.min(input.vat, cap);
  return {
    deductibleVat,
    nonDeductibleVat: input.vat - deductibleVat,
    costDeductible: false,
    note: input.kind === "meal_with_alcohol" ? "Schablon 46 kr per person" : "Momsavdrag begränsat till 36 kr per person",
  };
}
