import { yearOf } from "./dates.ts";
import { type Ore } from "./money.ts";
import { ratesFor } from "./rates.ts";

// Milersättning: the employer may pay any rate per mil, but only Skatteverket's
// schablon is tax-free; anything above it is taxable salary.

export type VehicleType = "own_car" | "company_car_electric" | "company_car_fuel";

export interface MileageInput {
  date: string;
  km: number;
  vehicle: VehicleType;
  /** Rate the company pays per mil; defaults to the tax-free rate. */
  companyRatePerMil?: Ore;
}

export interface MileageResult {
  mil: number;
  taxFreeRatePerMil: Ore;
  paidRatePerMil: Ore;
  taxFree: Ore;
  taxable: Ore;
  total: Ore;
}

export function calculateMileage(input: MileageInput): MileageResult {
  if (!(input.km > 0)) throw new Error("Antal kilometer måste vara större än noll");
  const { mileage } = ratesFor(yearOf(input.date));
  const taxFreeRatePerMil =
    input.vehicle === "own_car" ? mileage.ownCar : input.vehicle === "company_car_electric" ? mileage.companyCarElectric : mileage.companyCarFuel;
  const paidRatePerMil = input.companyRatePerMil ?? taxFreeRatePerMil;
  const mil = input.km / 10;
  const total = Math.round(paidRatePerMil * mil);
  const taxFree = Math.min(total, Math.round(taxFreeRatePerMil * mil));
  return { mil, taxFreeRatePerMil, paidRatePerMil, taxFree, taxable: total - taxFree, total };
}
