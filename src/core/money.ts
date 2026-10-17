// All amounts are integer öre (1 SEK = 100 öre) so sums never drift.

export type Ore = number;

export function kr(amount: number): Ore {
  return Math.round(amount * 100);
}

export function toKr(ore: Ore): number {
  return ore / 100;
}

/** Rounds half away from zero to whole kronor, returned in öre. */
export function roundToKrona(ore: Ore): Ore {
  return Math.sign(ore) * Math.round(Math.abs(ore) / 100) * 100;
}

/** Formats öre as a Swedish amount string, e.g. 123456 -> "1 234,56". */
export function formatSek(ore: Ore): string {
  const sign = ore < 0 ? "-" : "";
  const abs = Math.abs(ore);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole},${frac}`;
}

/** Parses "1 234,56", "1234.56", "1.234,56" or "1,234.56" into öre. Returns null if not a number. */
export function parseAmount(text: string): Ore | null {
  let s = text.replace(/[\s ]/g, "").replace(/(kr|sek|:-)$/i, "");
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimalSep = lastComma > lastDot ? "," : lastDot > lastComma ? "." : null;
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    const decimals = s.length - idx - 1;
    if (decimals === 3 && s.indexOf(decimalSep) === idx && (decimalSep === "." ? !s.includes(",") : !s.includes("."))) {
      // "1.234" or "1,234" with exactly three trailing digits: a thousands separator.
      s = s.replace(/[.,]/g, "");
    } else {
      const thousands = decimalSep === "," ? "." : ",";
      s = s.split(thousands).join("").replace(decimalSep, ".");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? kr(n) : null;
}

/** Splits a VAT-inclusive amount into net and VAT for the given rate in percent. */
export function vatFromGross(gross: Ore, ratePercent: number): { net: Ore; vat: Ore } {
  const vat = Math.round((gross * ratePercent) / (100 + ratePercent));
  return { net: gross - vat, vat };
}

export function sum(values: Ore[]): Ore {
  return values.reduce((a, b) => a + b, 0);
}
