import type { Voucher } from "./accounting.ts";
import type { Ore } from "./money.ts";

// SIE 4I export so vouchers can be imported into Fortnox (or any Swedish
// accounting system) without the API. SIE files are encoded as IBM PC8 (CP437).

export interface SieMeta {
  companyName: string;
  organisationNumber: string;
  generatedOn: string;
  accountNames: Record<string, string>;
}

const CP437: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "å": 0x86, "ç": 0x87,
  "ê": 0x88, "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c, "ì": 0x8d, "Ä": 0x8e, "Å": 0x8f,
  "É": 0x90, "æ": 0x91, "Æ": 0x92, "ô": 0x93, "ö": 0x94, "ò": 0x95, "û": 0x96, "ù": 0x97,
  "ÿ": 0x98, "Ö": 0x99, "Ü": 0x9a, "ø": 0x9b, "£": 0x9c, "Ø": 0x9d, "á": 0xa0, "í": 0xa1,
  "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5,
};

export function encodeCp437(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let i = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out[i++] = code < 0x80 ? code : (CP437[ch] ?? (ch === "–" || ch === "—" ? 0x2d : 0x3f));
  }
  return out.subarray(0, i);
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function amount(ore: Ore): string {
  return (ore / 100).toFixed(2);
}

function sieDate(date: string): string {
  return date.replaceAll("-", "");
}

// SIE dimension numbers: 1 = kostnadsställe, 6 = projekt.
function objectList(row: { project?: string; costCenter?: string }): string {
  const parts: string[] = [];
  if (row.costCenter) parts.push(`1 ${quote(row.costCenter)}`);
  if (row.project) parts.push(`6 ${quote(row.project)}`);
  return `{${parts.join(" ")}}`;
}

export function toSie(vouchers: Voucher[], meta: SieMeta): string {
  const lines = [
    "#FLAGGA 0",
    "#FORMAT PC8",
    "#SIETYP 4",
    `#PROGRAM ${quote("Reverse-kvitto")} 0.1`,
    `#GEN ${sieDate(meta.generatedOn)}`,
    `#FNAMN ${quote(meta.companyName)}`,
    `#ORGNR ${meta.organisationNumber}`,
    "#KPTYP BAS2014",
    `#DIM 1 ${quote("Kostnadsställe")}`,
    `#DIM 6 ${quote("Projekt")}`,
  ];
  const accounts = [...new Set(vouchers.flatMap((v) => v.rows.map((r) => r.account)))].sort();
  for (const account of accounts) lines.push(`#KONTO ${account} ${quote(meta.accountNames[account] ?? account)}`);
  const objects = new Map<string, string>();
  for (const row of vouchers.flatMap((v) => v.rows)) {
    if (row.costCenter) objects.set(`1 ${quote(row.costCenter)}`, row.costCenter);
    if (row.project) objects.set(`6 ${quote(row.project)}`, row.project);
  }
  for (const [key, name] of objects) lines.push(`#OBJEKT ${key} ${quote(name)}`);

  for (const v of vouchers) {
    lines.push(`#VER ${quote(v.series)} "" ${sieDate(v.transactionDate)} ${quote(v.description)}`, "{");
    for (const row of v.rows) {
      const value = row.debit - row.credit;
      lines.push(`   #TRANS ${row.account} ${objectList(row)} ${amount(value)}${row.text ? ` "" ${quote(row.text)}` : ""}`);
    }
    lines.push("}");
  }
  return lines.join("\r\n") + "\r\n";
}
