import { addMonths, daysBetween, eachDate, parseLocalDateTime, yearOf } from "./dates.ts";
import { roundToKrona, sum, type Ore } from "./money.ts";
import { foreignNormalAmount, ratesFor, type MealReductionPercents } from "./rates.ts";

// Traktamente (per diem) per Skatteverket's rules:
// - tax-free only for a trip with an overnight stay more than 50 km from home and workplace
// - departure day counts as a half day if the trip starts at 12:00 or later,
//   the return day if it ends at 19:00 or earlier
// - free meals reduce the day's maximum amount
// - after three months at the same location the amount drops to 70 %, after two years to 50 %
// - nattraktamente is paid only for nights without employer-paid lodging

export type Meals = { breakfast?: boolean; lunch?: boolean; dinner?: boolean };

export interface TripInput {
  /** Local time the trip starts, "YYYY-MM-DDTHH:mm". */
  departure: string;
  /** Local time the trip ends, "YYYY-MM-DDTHH:mm". */
  return: string;
  /** ISO country code of the destination; "SE" for domestic trips. */
  country: string;
  /** Distance from home and regular workplace, if known. */
  distanceKm?: number;
  /** Per-date country, for trips that span several countries. */
  dayCountries?: Record<string, string>;
  /** Free meals (paid by the employer or included in the hotel price) per date. */
  freeMeals?: Record<string, Meals>;
  /** Nights (by the evening's date) without paid lodging that qualify for nattraktamente, or "all". */
  nightAllowance?: "all" | string[];
  /** Date the employee started working at this location, for long-term reductions. Defaults to the departure date. */
  sameLocationSince?: string;
  /** Overrides of foreign normalbelopp by country code. */
  foreignOverrides?: Record<string, Ore>;
}

export interface PerDiemDay {
  date: string;
  country: string;
  domestic: boolean;
  kind: "full" | "half";
  /** Percent of the normal amount applied for long-term stays (100, 70 or 50). */
  longTermPercent: number;
  /** Maximum tax-free amount for the day before meal reductions. */
  maxAmount: Ore;
  mealReduction: Ore;
  amount: Ore;
}

export interface PerDiemNight {
  date: string;
  country: string;
  domestic: boolean;
  amount: Ore;
}

export interface PerDiemResult {
  eligible: boolean;
  reasons: string[];
  days: PerDiemDay[];
  nights: PerDiemNight[];
  domesticTotal: Ore;
  foreignTotal: Ore;
  total: Ore;
}

const NOON = 12 * 60;
const SEVEN_PM = 19 * 60;

export function mealReductionPercent(meals: Meals | undefined, percents: MealReductionPercents): number {
  if (!meals) return 0;
  return (meals.breakfast ? percents.breakfast : 0) + (meals.lunch ? percents.lunch : 0) + (meals.dinner ? percents.dinner : 0);
}

export function calculatePerDiem(trip: TripInput): PerDiemResult {
  const dep = parseLocalDateTime(trip.departure);
  const ret = parseLocalDateTime(trip.return);
  if (ret.date < dep.date || (ret.date === dep.date && ret.minutes <= dep.minutes)) {
    throw new Error("Hemkomst måste vara efter avresa");
  }

  const rates = ratesFor(yearOf(dep.date));
  const reasons: string[] = [];
  if (dep.date === ret.date) {
    reasons.push("Resan saknar övernattning – traktamente är skattepliktigt för endagsresor");
  }
  if (trip.distanceKm !== undefined && trip.distanceKm <= rates.minDistanceKm) {
    reasons.push(`Förrättningsorten ligger inte mer än ${rates.minDistanceKm} km från bostaden och tjänstestället`);
  }
  const empty: PerDiemResult = { eligible: false, reasons, days: [], nights: [], domesticTotal: 0, foreignTotal: 0, total: 0 };
  if (reasons.length > 0) return empty;

  const since = trip.sameLocationSince ?? dep.date;
  const threeMonths = addMonths(since, 3);
  const twoYears = addMonths(since, 24);
  const countryOn = (date: string) => (trip.dayCountries?.[date] ?? trip.country).toUpperCase();

  const days: PerDiemDay[] = eachDate(dep.date, ret.date).map((date) => {
    // The 12:00/19:00 half-day rule applies to the first and last day only.
    const half = (date === dep.date && dep.minutes >= NOON) || (date === ret.date && ret.minutes <= SEVEN_PM);
    const country = countryOn(date);
    const domestic = country === "SE";
    const longTermPercent = date >= twoYears ? rates.domestic.after2YearsPercent : date >= threeMonths ? rates.domestic.after3MonthsPercent : 100;

    const fullDay = domestic ? rates.domestic.fullDay : foreignNormalAmount(rates, country, trip.foreignOverrides);
    const maxAmount = roundToKrona((fullDay * (half ? 50 : 100) * longTermPercent) / 10_000);
    const percent = mealReductionPercent(trip.freeMeals?.[date], domestic ? rates.domesticMeals : rates.foreignMeals);
    const mealReduction = Math.min(maxAmount, roundToKrona((maxAmount * percent) / 100));
    return { date, country, domestic, kind: half ? "half" : "full", longTermPercent, maxAmount, mealReduction, amount: maxAmount - mealReduction };
  });

  const nightDates = eachDate(dep.date, ret.date).slice(0, daysBetween(dep.date, ret.date));
  const claimed = trip.nightAllowance === "all" ? nightDates : nightDates.filter((d) => trip.nightAllowance?.includes(d));
  const nights: PerDiemNight[] = claimed.map((date) => {
    const country = countryOn(date);
    const domestic = country === "SE";
    const amount = domestic ? rates.domestic.night : roundToKrona(foreignNormalAmount(rates, country, trip.foreignOverrides) / 2);
    return { date, country, domestic, amount };
  });

  const domesticTotal = sum([...days, ...nights].filter((x) => x.domestic).map((x) => x.amount));
  const foreignTotal = sum([...days, ...nights].filter((x) => !x.domestic).map((x) => x.amount));
  return { eligible: true, reasons, days, nights, domesticTotal, foreignTotal, total: domesticTotal + foreignTotal };
}
