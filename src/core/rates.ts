import { kr, type Ore } from "./money.ts";

// Skatteverket schablonbelopp for inkomstår 2026 (SKV 354 utgåva 36, "Belopp och
// procentsatser för inkomstår 2026"). Rates are versioned per year so old reports
// keep the amounts that applied when the trip was made.

export interface DomesticPerDiem {
  fullDay: Ore;
  halfDay: Ore;
  night: Ore;
  /** Percent of the full-day amount after three months on the same location. */
  after3MonthsPercent: number;
  /** Percent of the full-day amount after two years on the same location. */
  after2YearsPercent: number;
}

export interface MileageRates {
  /** Tax-free reimbursement per mil (10 km) for the employee's own car. */
  ownCar: Ore;
  /** Fully electric company car (förmånsbil), employee pays the electricity. */
  companyCarElectric: Ore;
  /** Any other company car, employee pays the fuel. */
  companyCarFuel: Ore;
}

/** Meal reductions in percent of the day's maximum amount. */
export interface MealReductionPercents {
  breakfast: number;
  lunch: number;
  dinner: number;
}

export interface RepresentationRules {
  /** VAT base cap per person and occasion, excluding VAT. */
  baseCapPerPerson: Ore;
  /** Restaurant VAT rate in percent applied to the capped base. */
  restaurantVatPercent: number;
  /** Flat VAT deduction per person when the meal includes alcohol and exceeds the cap. */
  flatRateWithAlcoholPerPerson: Ore;
}

export interface YearRates {
  year: number;
  domestic: DomesticPerDiem;
  domesticMeals: MealReductionPercents;
  foreignMeals: MealReductionPercents;
  /** Normalbelopp per full day abroad, keyed by ISO 3166-1 alpha-2 country code. */
  foreignNormal: Record<string, Ore>;
  /** Normalbelopp for countries not on Skatteverket's list ("Övriga länder och områden"). */
  foreignFallback: Ore;
  mileage: MileageRates;
  representation: RepresentationRules;
  /** Minimum distance in km from both home and regular workplace for tax-free per diem. */
  minDistanceKm: number;
}

const RATES_2026: YearRates = {
  year: 2026,
  domestic: {
    fullDay: kr(300),
    halfDay: kr(150),
    night: kr(150),
    after3MonthsPercent: 70,
    after2YearsPercent: 50,
  },
  // Inrikes: frukost 20 %, lunch 35 %, middag 35 % of the day's maximum (300 -> 60/105/105, all three 270).
  domesticMeals: { breakfast: 20, lunch: 35, dinner: 35 },
  // Utrikes: frukost 15 %, lunch 35 %, middag 35 % of the normalbelopp (all three 85 %).
  foreignMeals: { breakfast: 15, lunch: 35, dinner: 35 },
  // A subset of Skatteverket's 2026 list; extend or override through settings.
  foreignNormal: {
    DK: kr(1226),
    NO: kr(1054),
    FI: kr(968),
    DE: kr(760),
    GB: kr(901),
    FR: kr(850),
    ES: kr(635),
    US: kr(1049),
  },
  foreignFallback: kr(470),
  mileage: {
    ownCar: kr(25),
    companyCarElectric: kr(9.5),
    companyCarFuel: kr(12),
  },
  representation: {
    baseCapPerPerson: kr(300),
    restaurantVatPercent: 12,
    flatRateWithAlcoholPerPerson: kr(46),
  },
  minDistanceKm: 50,
};

const BY_YEAR: Record<number, YearRates> = { 2026: RATES_2026 };

/** Returns the rates for a year, falling back to the closest known year. */
export function ratesFor(year: number): YearRates {
  const exact = BY_YEAR[year];
  if (exact) return exact;
  const years = Object.keys(BY_YEAR).map(Number).sort((a, b) => a - b);
  const closest = years.reduce((best, y) => (Math.abs(y - year) < Math.abs(best - year) ? y : best), years[0]!);
  return BY_YEAR[closest]!;
}

export function foreignNormalAmount(rates: YearRates, country: string, overrides: Record<string, Ore> = {}): Ore {
  const code = country.toUpperCase();
  return overrides[code] ?? rates.foreignNormal[code] ?? rates.foreignFallback;
}

export const KNOWN_YEARS = Object.keys(BY_YEAR).map(Number);
