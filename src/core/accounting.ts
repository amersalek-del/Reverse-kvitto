import type { Dimensions, Report, Settings } from "./model.ts";
import { sum, type Ore } from "./money.ts";
import type { ReportSummary } from "./report.ts";

// Turns an approved report into vouchers ("verifikationer") for Fortnox Bokföring.
// Private outlays are credited to the employee liability account, which payroll
// clears when the money is paid out; company card purchases are credited to the
// card account. Per diem and mileage are booked here only when settings route
// allowances to bookkeeping instead of Fortnox Lön.

export interface VoucherRow extends Dimensions {
  account: string;
  debit: Ore;
  credit: Ore;
  text?: string;
}

export interface Voucher {
  series: string;
  transactionDate: string;
  description: string;
  rows: VoucherRow[];
  /** Report entries booked on this voucher, so their receipt images can be attached. */
  entryIds: string[];
}

interface Posting {
  entryId: string;
  date: string;
  description: string;
  rows: VoucherRow[];
}

function dims(d: Dimensions): Dimensions {
  return { ...(d.project ? { project: d.project } : {}), ...(d.costCenter ? { costCenter: d.costCenter } : {}) };
}

function postingsFor(summary: ReportSummary, settings: Settings): Posting[] {
  const a = settings.accounts;
  const postings: Posting[] = [];

  for (const line of summary.receipts) {
    const { entry } = line;
    const creditAccount = entry.payment === "company_card" ? a.companyCard : a.employeeLiability;
    const text = `${entry.merchant} ${entry.description}`.trim();
    const rows: VoucherRow[] = [{ account: line.costAccount, debit: line.cost, credit: 0, text, ...dims(entry) }];
    if (line.deductibleVat > 0) rows.push({ account: a.inputVat, debit: line.deductibleVat, credit: 0, text });
    rows.push({ account: creditAccount, debit: 0, credit: line.grossSek, text });
    postings.push({ entryId: entry.id, date: entry.date, description: text, rows });
  }

  if (settings.allowancesTo === "bookkeeping") {
    for (const { entry, result } of summary.trips) {
      const rows: VoucherRow[] = [];
      if (result.domesticTotal > 0) rows.push({ account: a.perDiemDomesticTaxFree, debit: result.domesticTotal, credit: 0, ...dims(entry) });
      if (result.foreignTotal > 0) rows.push({ account: a.perDiemForeignTaxFree, debit: result.foreignTotal, credit: 0, ...dims(entry) });
      if (rows.length === 0) continue;
      rows.push({ account: a.employeeLiability, debit: 0, credit: result.total });
      postings.push({ entryId: entry.id, date: entry.trip.return.slice(0, 10), description: `Traktamente ${entry.destination}`, rows });
    }
    for (const { entry, result } of summary.mileage) {
      const rows: VoucherRow[] = [{ account: a.mileageTaxFree, debit: result.taxFree, credit: 0, ...dims(entry) }];
      if (result.taxable > 0) rows.push({ account: a.mileageTaxable, debit: result.taxable, credit: 0, ...dims(entry) });
      rows.push({ account: a.employeeLiability, debit: 0, credit: result.total });
      postings.push({ entryId: entry.id, date: entry.date, description: `Milersättning ${entry.from}–${entry.to}`, rows });
    }
  }
  return postings;
}

/** Merges rows with the same account and dimensions so a report voucher stays readable. */
export function mergeRows(rows: VoucherRow[]): VoucherRow[] {
  const merged = new Map<string, VoucherRow>();
  for (const row of rows) {
    const side = row.debit > 0 ? "D" : "C";
    const key = [row.account, side, row.project ?? "", row.costCenter ?? ""].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.debit += row.debit;
      existing.credit += row.credit;
      if (existing.text !== row.text) delete existing.text;
    } else {
      merged.set(key, { ...row });
    }
  }
  return [...merged.values()];
}

export function assertBalanced(voucher: Voucher): void {
  const debit = sum(voucher.rows.map((r) => r.debit));
  const credit = sum(voucher.rows.map((r) => r.credit));
  if (debit !== credit) throw new Error(`Verifikationen balanserar inte: debet ${debit} ≠ kredit ${credit}`);
}

export function buildVouchers(report: Report, summary: ReportSummary, employeeName: string, settings: Settings): Voucher[] {
  const postings = postingsFor(summary, settings);
  if (postings.length === 0) return [];

  let vouchers: Voucher[];
  if (settings.voucherMode === "per_entry") {
    vouchers = postings.map((p) => ({
      series: settings.voucherSeries,
      transactionDate: p.date,
      description: `${employeeName}: ${p.description}`.slice(0, 200),
      rows: p.rows,
      entryIds: [p.entryId],
    }));
  } else {
    const latest = postings.map((p) => p.date).sort().at(-1)!;
    vouchers = [
      {
        series: settings.voucherSeries,
        transactionDate: latest,
        description: `Utläggsrapport ${employeeName}: ${report.title}`.slice(0, 200),
        rows: mergeRows(postings.flatMap((p) => p.rows)),
        entryIds: postings.map((p) => p.entryId),
      },
    ];
  }
  vouchers.forEach(assertBalanced);
  return vouchers;
}
