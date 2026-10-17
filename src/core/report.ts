import { findCategory, type Category } from "./categories.ts";
import { calculateMileage, type MileageResult } from "./mileage.ts";
import type { MileageEntry, ReceiptEntry, Report, Settings, TripEntry } from "./model.ts";
import { sum, vatFromGross, type Ore } from "./money.ts";
import { representationVat } from "./representation.ts";
import { calculatePerDiem, type PerDiemResult } from "./traktamente.ts";

export interface ReceiptLine {
  entry: ReceiptEntry;
  category: Category;
  /** Paid amount converted to SEK. */
  grossSek: Ore;
  foreign: boolean;
  deductibleVat: Ore;
  /** Cost booked on the cost account (gross minus deductible VAT). */
  cost: Ore;
  costAccount: string;
}

export interface MileageLine {
  entry: MileageEntry;
  result: MileageResult;
}

export interface TripLine {
  entry: TripEntry;
  result: PerDiemResult;
}

export interface ReportSummary {
  receipts: ReceiptLine[];
  mileage: MileageLine[];
  trips: TripLine[];
  totals: {
    privateOutlays: Ore;
    companyCard: Ore;
    perDiemDomestic: Ore;
    perDiemForeign: Ore;
    mileageTaxFree: Ore;
    mileageTaxable: Ore;
    /** Everything the employee gets paid out through payroll. */
    toEmployee: Ore;
  };
  warnings: string[];
}

export const VALID_VAT_RATES = [0, 6, 12, 25];

export function evaluateReceipt(entry: ReceiptEntry, settings: Settings): ReceiptLine {
  const category = findCategory(settings.categories, entry.categoryId);
  const foreign = entry.currency.toUpperCase() !== "SEK";
  const grossSek = foreign ? Math.round(entry.amount * entry.exchangeRate) : entry.amount;

  // Foreign VAT cannot be deducted in the Swedish VAT return, so the whole amount is cost.
  if (foreign) {
    return { entry, category, grossSek, foreign, deductibleVat: 0, cost: grossSek, costAccount: category.foreignAccount ?? category.account };
  }

  const vat = entry.vatOverride ?? vatFromGross(grossSek, entry.vatRate).vat;
  if (category.representation && entry.representation) {
    const rep = representationVat({
      date: entry.date,
      kind: entry.representation.kind,
      persons: Math.max(1, entry.representation.attendees.length),
      gross: grossSek,
      vat,
    });
    const costAccount = rep.costDeductible ? category.representation.deductibleAccount : category.representation.nonDeductibleAccount;
    return { entry, category, grossSek, foreign, deductibleVat: rep.deductibleVat, cost: grossSek - rep.deductibleVat, costAccount };
  }
  return { entry, category, grossSek, foreign, deductibleVat: vat, cost: grossSek - vat, costAccount: category.account };
}

export function summarizeReport(report: Report, settings: Settings): ReportSummary {
  const warnings: string[] = [];
  const receipts: ReceiptLine[] = [];
  const mileage: MileageLine[] = [];
  const trips: TripLine[] = [];

  for (const entry of report.entries) {
    if (entry.kind === "receipt") {
      const line = evaluateReceipt(entry, settings);
      receipts.push(line);
      if (entry.attachmentIds.length === 0) warnings.push(`${entry.merchant || "Kvitto"} ${entry.date}: kvittobild saknas`);
      if (!VALID_VAT_RATES.includes(entry.vatRate)) warnings.push(`${entry.merchant} ${entry.date}: ogiltig momssats ${entry.vatRate} %`);
      if (line.category.representation) {
        if (!entry.representation) warnings.push(`${entry.merchant} ${entry.date}: representation kräver deltagare och syfte`);
        else if (entry.representation.attendees.length === 0 || !entry.representation.purpose.trim()) {
          warnings.push(`${entry.merchant} ${entry.date}: ange deltagare och syfte för representationen`);
        }
      }
    } else if (entry.kind === "mileage") {
      mileage.push({ entry, result: calculateMileage(entry) });
    } else {
      const result = calculatePerDiem({ ...entry.trip, foreignOverrides: { ...settings.foreignNormalOverrides, ...entry.trip.foreignOverrides } });
      trips.push({ entry, result });
      for (const reason of result.reasons) warnings.push(`${entry.destination}: ${reason}`);
    }
  }

  // Nattraktamente compensates for lodging the employee arranged without receipts;
  // claiming it on a night that also has a hotel receipt pays twice.
  const lodgingDates = new Set(receipts.filter((r) => r.category.id === "lodging").map((r) => r.entry.date));
  for (const { entry, result } of trips) {
    for (const night of result.nights) {
      if (lodgingDates.has(night.date)) warnings.push(`${entry.destination}: nattraktamente ${night.date} trots hotellkvitto samma datum`);
    }
  }

  const privateOutlays = sum(receipts.filter((r) => r.entry.payment === "private").map((r) => r.grossSek));
  const companyCard = sum(receipts.filter((r) => r.entry.payment === "company_card").map((r) => r.grossSek));
  const perDiemDomestic = sum(trips.map((t) => t.result.domesticTotal));
  const perDiemForeign = sum(trips.map((t) => t.result.foreignTotal));
  const mileageTaxFree = sum(mileage.map((m) => m.result.taxFree));
  const mileageTaxable = sum(mileage.map((m) => m.result.taxable));
  return {
    receipts,
    mileage,
    trips,
    totals: {
      privateOutlays,
      companyCard,
      perDiemDomestic,
      perDiemForeign,
      mileageTaxFree,
      mileageTaxable,
      toEmployee: privateOutlays + perDiemDomestic + perDiemForeign + mileageTaxFree + mileageTaxable,
    },
    warnings,
  };
}

/** The amount approval limits are compared against: everything the report costs the company. */
export function reportTotal(summary: ReportSummary): Ore {
  return summary.totals.toEmployee + summary.totals.companyCard;
}
