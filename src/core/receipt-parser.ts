import { suggestCategory, type Category } from "./categories.ts";
import { assertDate } from "./dates.ts";
import { parseAmount, type Ore } from "./money.ts";

// "Kvittotolkning": extracts merchant, date, total, VAT and currency from the text
// of a receipt. The text comes from OCR (any engine) or a digital receipt; the
// parser only proposes values, the user confirms them before saving.

export interface VatLine {
  rate: number;
  vat: Ore;
  net?: Ore;
}

export interface ParsedReceipt {
  merchant?: string;
  organisationNumber?: string;
  date?: string;
  total?: Ore;
  currency: string;
  vatLines: VatLine[];
  /** VAT rate when the receipt has a single rate. */
  vatRate?: number;
  vatTotal?: Ore;
  categoryId?: string;
  /** Fields that were found, so the UI can highlight what needs checking. */
  found: string[];
}

const AMOUNT = /-?\d{1,3}(?:[  .]\d{3})+[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;
const TOTAL_LABELS = /(att betala|totalt|total|summa|to pay|amount due|grand total|betalt|kortköp|kort)\b/i;
const STRONG_TOTAL = /(att betala|totalt|total|to pay|amount due|grand total)\b/i;
const IGNORE_FOR_TOTAL = /(moms|vat|netto|exkl|växel|change|rabatt|discount|ören|avrundning)/i;

function amounts(line: string): Ore[] {
  return (line.match(AMOUNT) ?? []).map((m) => parseAmount(m)).filter((n): n is Ore => n !== null);
}

export function isValidOrgNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    total += d;
  }
  return total % 10 === 0;
}

function findDate(text: string): string | undefined {
  const candidates: string[] = [];
  for (const m of text.matchAll(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/g)) candidates.push(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
  for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/g)) candidates.push(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  for (const m of text.matchAll(/\b(\d{2})-(\d{2})-(\d{2})\b/g)) candidates.push(`20${m[1]}-${m[2]}-${m[3]}`);
  return candidates.find((d) => {
    try {
      assertDate(d);
      return true;
    } catch {
      return false;
    }
  });
}

function findCurrency(text: string): string {
  if (/\bEUR\b|€/i.test(text)) return "EUR";
  if (/\bNOK\b/i.test(text)) return "NOK";
  if (/\bDKK\b/i.test(text)) return "DKK";
  if (/\bGBP\b|£/i.test(text)) return "GBP";
  if (/\bUSD\b|US\$/i.test(text)) return "USD";
  return "SEK";
}

function findVatLines(lines: string[]): VatLine[] {
  const result: VatLine[] = [];
  let inVatTable = false;
  for (const line of lines) {
    // A "Moms% Moms Netto Brutto" header means the following rows start with a bare rate.
    if (/(moms|vat|mva)\s*%|momssats/i.test(line) && amounts(line).length === 0) {
      inVatTable = true;
      continue;
    }
    const rateMatch = /(\d{1,2})(?:[.,]0{1,2})?\s*%/.exec(line) ?? (inVatTable ? /^(\d{1,2})(?:[.,]0{1,2})?(?=\s)/.exec(line) : null);
    if (!rateMatch) {
      inVatTable = false;
      continue;
    }
    const rate = Number(rateMatch[1]);
    if (![6, 12, 25].includes(rate)) continue;
    const rest = line.slice(rateMatch.index + rateMatch[0].length);
    const values = amounts(rest);
    if (values.length === 0) continue;

    // Tables often read "Moms% Moms Netto Brutto"; find the value that is the VAT of another.
    let vatLine: VatLine | undefined;
    for (const vat of values) {
      const net = values.find((n) => n !== vat && Math.abs(Math.round((n * rate) / 100) - vat) <= 1);
      if (net !== undefined) {
        vatLine = { rate, vat, net };
        break;
      }
    }
    if (!vatLine && /moms|vat|mva/i.test(line)) vatLine = { rate, vat: values[0]! };
    if (vatLine && !result.some((v) => v.rate === vatLine.rate)) result.push(vatLine);
  }
  return result;
}

function findTotal(lines: string[]): Ore | undefined {
  const scored: { amount: Ore; score: number }[] = [];
  for (const line of lines) {
    if (IGNORE_FOR_TOTAL.test(line)) continue;
    const values = amounts(line);
    if (values.length === 0 || !TOTAL_LABELS.test(line)) continue;
    scored.push({ amount: values.at(-1)!, score: STRONG_TOTAL.test(line) ? 2 : 1 });
  }
  if (scored.length > 0) {
    const best = Math.max(...scored.map((s) => s.score));
    return Math.max(...scored.filter((s) => s.score === best).map((s) => s.amount));
  }
  const all = lines.filter((l) => !IGNORE_FOR_TOTAL.test(l)).flatMap(amounts);
  return all.length > 0 ? Math.max(...all) : undefined;
}

function findMerchant(lines: string[]): string | undefined {
  return lines
    .map((l) => l.trim())
    .find((l) => /[a-zåäö]{2,}/i.test(l) && !/^(kvitto|receipt|kopia|copy|välkommen|welcome)\b/i.test(l) && !/\d{6}-?\d{4}/.test(l));
}

export function parseReceiptText(text: string, categories: Category[]): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const found: string[] = [];
  const result: ParsedReceipt = { currency: findCurrency(text), vatLines: [], found };

  result.merchant = findMerchant(lines);
  if (result.merchant) found.push("merchant");

  for (const m of text.matchAll(/\b(\d{6})-?(\d{4})\b/g)) {
    if (isValidOrgNumber(m[1]! + m[2]!)) {
      result.organisationNumber = `${m[1]}-${m[2]}`;
      found.push("organisationNumber");
      break;
    }
  }

  result.date = findDate(text);
  if (result.date) found.push("date");

  result.total = findTotal(lines);
  if (result.total !== undefined) found.push("total");

  result.vatLines = findVatLines(lines);
  if (result.vatLines.length > 0) {
    found.push("vat");
    result.vatTotal = result.vatLines.reduce((s, v) => s + v.vat, 0);
    if (result.vatLines.length === 1) result.vatRate = result.vatLines[0]!.rate;
  }

  const category = suggestCategory(categories, text);
  if (category) {
    result.categoryId = category.id;
    if (result.vatRate === undefined && result.vatLines.length === 0) result.vatRate = category.vatRate;
  }
  return result;
}
