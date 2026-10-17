import type { Employee, Settings } from "./model.ts";
import type { Ore } from "./money.ts";
import type { ReportSummary } from "./report.ts";

// Payroll lines ("lönetransaktioner") for Fortnox Lön. Private outlays are paid
// back net of tax; per diem and mileage are split into tax-free and taxable
// salary codes so payroll can withhold tax and employer contributions correctly.
// Payroll always pays out everything the employee is owed; settings.allowancesTo
// only decides whether the allowance cost is booked by our voucher or by Lön.

export interface PayrollLine {
  employeeNumber: string;
  salaryCode: string;
  date: string;
  quantity: number;
  /** Amount per unit in öre. */
  rate: Ore;
  amount: Ore;
  text: string;
  project?: string;
  costCenter?: string;
}

export function buildPayrollLines(employee: Employee, summary: ReportSummary, settings: Settings): PayrollLine[] {
  const codes = settings.salaryCodes;
  const lines: PayrollLine[] = [];
  const base = { employeeNumber: employee.employeeNumber };

  const outlays = summary.receipts.filter((r) => r.entry.payment === "private");
  if (outlays.length > 0) {
    const amount = outlays.reduce((s, r) => s + r.grossSek, 0);
    const date = outlays.map((r) => r.entry.date).sort().at(-1)!;
    lines.push({ ...base, salaryCode: codes.outlay, date, quantity: 1, rate: amount, amount, text: `Utlägg (${outlays.length} kvitton)` });
  }

  for (const { entry, result } of summary.trips) {
    const date = entry.trip.return.slice(0, 10);
    const dims = { ...(entry.project ? { project: entry.project } : {}), ...(entry.costCenter ? { costCenter: entry.costCenter } : {}) };
    const parts: [boolean, string][] = [
      [true, codes.perDiemDomesticTaxFree],
      [false, codes.perDiemForeignTaxFree],
    ];
    for (const [domestic, salaryCode] of parts) {
      const items = [...result.days, ...result.nights].filter((x) => x.domestic === domestic && x.amount > 0);
      const amount = items.reduce((s, x) => s + x.amount, 0);
      if (amount === 0) continue;
      // Days carry different amounts (half days, meals), so one line with quantity 1 keeps the total exact.
      const days = result.days.filter((d) => d.domestic === domestic).length;
      lines.push({ ...base, ...dims, salaryCode, date, quantity: 1, rate: amount, amount, text: `Traktamente ${entry.destination} (${days} dagar)` });
    }
  }
  for (const { entry, result } of summary.mileage) {
    const dims = { ...(entry.project ? { project: entry.project } : {}), ...(entry.costCenter ? { costCenter: entry.costCenter } : {}) };
    const text = `Milersättning ${entry.from}–${entry.to}`;
    lines.push({ ...base, ...dims, salaryCode: codes.mileageTaxFree, date: entry.date, quantity: result.mil, rate: result.taxFreeRatePerMil, amount: result.taxFree, text });
    if (result.taxable > 0) {
      const rate = result.paidRatePerMil - result.taxFreeRatePerMil;
      lines.push({ ...base, ...dims, salaryCode: codes.mileageTaxable, date: entry.date, quantity: result.mil, rate, amount: result.taxable, text });
    }
  }
  return lines;
}

export function payrollCsv(lines: PayrollLine[]): string {
  const header = "Anställningsnummer;Löneart;Datum;Antal;À-pris;Belopp;Text;Projekt;Kostnadsställe";
  const fmt = (ore: Ore) => (ore / 100).toFixed(2).replace(".", ",");
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = lines.map((l) =>
    [l.employeeNumber, l.salaryCode, l.date, String(l.quantity).replace(".", ","), fmt(l.rate), fmt(l.amount), esc(l.text), l.project ?? "", l.costCenter ?? ""].join(";"),
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}
