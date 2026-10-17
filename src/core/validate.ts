import { findCategory } from "./categories.ts";
import { assertDate, parseLocalDateTime } from "./dates.ts";
import type { Entry, MileageEntry, ReceiptEntry, Settings, TripEntry } from "./model.ts";
import type { VehicleType } from "./mileage.ts";
import type { RepresentationKind } from "./representation.ts";
import { VALID_VAT_RATES } from "./report.ts";

// Validates untrusted entry input from the API and returns a clean entry.

export class ValidationError extends Error {}

type Input = Record<string, unknown>;

function str(input: Input, key: string, required = true): string {
  const v = input[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ValidationError(`Fältet ${key} saknas`);
    return "";
  }
  if (typeof v !== "string") throw new ValidationError(`Fältet ${key} måste vara text`);
  return v.trim();
}

function num(input: Input, key: string, opts: { required?: boolean; min?: number; integer?: boolean } = {}): number | undefined {
  const v = input[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new ValidationError(`Fältet ${key} saknas`);
    return undefined;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`Fältet ${key} måste vara ett tal`);
  if (opts.integer && !Number.isInteger(n)) throw new ValidationError(`Fältet ${key} måste vara ett heltal`);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError(`Fältet ${key} måste vara minst ${opts.min}`);
  return n;
}

function date(input: Input, key: string): string {
  const d = str(input, key);
  try {
    assertDate(d);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  return d;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (!allowed.includes(value as T)) throw new ValidationError(`Fältet ${key} måste vara en av: ${allowed.join(", ")}`);
  return value as T;
}

function dimensions(input: Input) {
  const project = str(input, "project", false);
  const costCenter = str(input, "costCenter", false);
  return { ...(project ? { project } : {}), ...(costCenter ? { costCenter } : {}) };
}

function receipt(id: string, input: Input, settings: Settings): ReceiptEntry {
  const categoryId = str(input, "categoryId");
  try {
    findCategory(settings.categories, categoryId);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const currency = (str(input, "currency", false) || "SEK").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError("Ogiltig valuta");
  const exchangeRate = currency === "SEK" ? 1 : num(input, "exchangeRate", { required: true, min: 0.0001 })!;
  const vatRate = num(input, "vatRate", { required: true, integer: true })!;
  if (!VALID_VAT_RATES.includes(vatRate)) throw new ValidationError(`Momssatsen måste vara en av ${VALID_VAT_RATES.join(", ")} %`);
  const amount = num(input, "amount", { required: true, integer: true, min: 1 })!;
  const vatOverride = num(input, "vatOverride", { integer: true, min: 0 });
  if (vatOverride !== undefined && vatOverride >= amount) throw new ValidationError("Momsen kan inte vara större än beloppet");
  const attachmentIds = Array.isArray(input.attachmentIds) ? input.attachmentIds.filter((x): x is string => typeof x === "string") : [];

  let representation: ReceiptEntry["representation"];
  if (input.representation && typeof input.representation === "object") {
    const rep = input.representation as Input;
    representation = {
      kind: oneOf<RepresentationKind>(rep.kind, ["meal_food_only", "meal_with_alcohol", "simple_refreshments"], "representation.kind"),
      attendees: Array.isArray(rep.attendees) ? rep.attendees.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [],
      purpose: typeof rep.purpose === "string" ? rep.purpose.trim() : "",
    };
  }

  return {
    id,
    kind: "receipt",
    date: date(input, "date"),
    merchant: str(input, "merchant"),
    description: str(input, "description", false),
    categoryId,
    currency,
    amount,
    exchangeRate,
    vatRate: currency === "SEK" ? vatRate : 0,
    ...(vatOverride !== undefined && currency === "SEK" ? { vatOverride } : {}),
    payment: oneOf(input.payment ?? "private", ["private", "company_card"] as const, "payment"),
    attachmentIds,
    ...(representation ? { representation } : {}),
    ...dimensions(input),
  };
}

function mileage(id: string, input: Input): MileageEntry {
  const companyRatePerMil = num(input, "companyRatePerMil", { integer: true, min: 0 });
  const registrationNumber = str(input, "registrationNumber", false);
  return {
    id,
    kind: "mileage",
    date: date(input, "date"),
    from: str(input, "from"),
    to: str(input, "to"),
    purpose: str(input, "purpose"),
    km: num(input, "km", { required: true, min: 0.1 })!,
    vehicle: oneOf<VehicleType>(input.vehicle ?? "own_car", ["own_car", "company_car_electric", "company_car_fuel"], "vehicle"),
    ...(registrationNumber ? { registrationNumber: registrationNumber.toUpperCase() } : {}),
    ...(companyRatePerMil !== undefined ? { companyRatePerMil } : {}),
    ...dimensions(input),
  };
}

function trip(id: string, input: Input): TripEntry {
  const t = (input.trip ?? {}) as Input;
  const departure = str(t, "departure");
  const ret = str(t, "return");
  try {
    parseLocalDateTime(departure);
    parseLocalDateTime(ret);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const country = str(t, "country").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new ValidationError("Land anges som tvåställig landskod, t.ex. SE eller DE");
  const distanceKm = num(t, "distanceKm", { min: 0 });
  const sameLocationSince = str(t, "sameLocationSince", false);
  if (sameLocationSince) date(t, "sameLocationSince");
  const nightAllowance = t.nightAllowance === "all" ? "all" : Array.isArray(t.nightAllowance) ? t.nightAllowance.filter((x): x is string => typeof x === "string") : [];
  const records = <T>(v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {});

  return {
    id,
    kind: "trip",
    purpose: str(input, "purpose"),
    destination: str(input, "destination"),
    trip: {
      departure,
      return: ret,
      country,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
      dayCountries: Object.fromEntries(Object.entries(records<string>(t.dayCountries)).map(([k, v]) => [k, String(v).toUpperCase()])),
      freeMeals: Object.fromEntries(
        Object.entries(records<Input>(t.freeMeals)).map(([k, v]) => [k, { breakfast: !!v?.breakfast, lunch: !!v?.lunch, dinner: !!v?.dinner }]),
      ),
      nightAllowance,
      ...(sameLocationSince ? { sameLocationSince } : {}),
    },
    ...dimensions(input),
  };
}

export function validateEntry(id: string, input: unknown, settings: Settings): Entry {
  if (!input || typeof input !== "object") throw new ValidationError("Ogiltig post");
  const i = input as Input;
  switch (i.kind) {
    case "receipt":
      return receipt(id, i, settings);
    case "mileage":
      return mileage(id, i);
    case "trip":
      return trip(id, i);
    default:
      throw new ValidationError("Okänd posttyp");
  }
}
