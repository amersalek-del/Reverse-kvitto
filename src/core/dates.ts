// Trips are entered in local Swedish time without a zone, so dates are handled as
// plain calendar values ("YYYY-MM-DD" and "YYYY-MM-DDTHH:mm") with UTC arithmetic.

export interface LocalDateTime {
  date: string;
  minutes: number;
}

export function parseLocalDateTime(value: string): LocalDateTime {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!m) throw new Error(`Ogiltig tidpunkt: ${value} (förväntat YYYY-MM-DDTHH:mm)`);
  assertDate(m[1]!);
  return { date: m[1]!, minutes: Number(m[2]) * 60 + Number(m[3]) };
}

export function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toUtc(date).toISOString().slice(0, 10) !== date) {
    throw new Error(`Ogiltigt datum: ${date}`);
  }
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the last day of the target month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}
