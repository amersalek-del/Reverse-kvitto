import { DEFAULT_CATEGORIES } from "./categories.ts";
import type { Settings } from "./model.ts";

/** Names for the BAS accounts the default setup books on, used in SIE exports and the UI. */
export const ACCOUNT_NAMES: Record<string, string> = {
  "2641": "Debiterad ingående moms",
  "2822": "Reseräkningar",
  "2890": "Övriga kortfristiga skulder",
  "5410": "Förbrukningsinventarier",
  "5420": "Programvaror",
  "5611": "Drivmedel för personbilar",
  "5810": "Biljetter",
  "5820": "Hyrbilskostnader",
  "5831": "Kost och logi i Sverige",
  "5832": "Kost och logi i utlandet",
  "5890": "Övriga resekostnader",
  "6071": "Representation, avdragsgill",
  "6072": "Representation, ej avdragsgill",
  "6110": "Kontorsmateriel",
  "6212": "Mobiltelefon",
  "6970": "Tidningar, tidskrifter och facklitteratur",
  "6990": "Övriga externa kostnader",
  "7321": "Skattefria traktamenten, Sverige",
  "7323": "Skattefria traktamenten, utlandet",
  "7331": "Skattefria bilersättningar",
  "7332": "Skattepliktiga bilersättningar",
  "7631": "Personalrepresentation, avdragsgill",
  "7632": "Personalrepresentation, ej avdragsgill",
};

export function defaultSettings(): Settings {
  return {
    companyName: "Demo AB",
    organisationNumber: "556677-8899",
    categories: structuredClone(DEFAULT_CATEGORIES),
    accounts: {
      employeeLiability: "2822",
      companyCard: "2890",
      inputVat: "2641",
      perDiemDomesticTaxFree: "7321",
      perDiemForeignTaxFree: "7323",
      mileageTaxFree: "7331",
      mileageTaxable: "7332",
    },
    voucherSeries: "A",
    voucherMode: "per_report",
    allowancesTo: "payroll",
    // Placeholders: map these to the lönearter set up in your Fortnox Lön.
    salaryCodes: {
      outlay: "UTLAGG",
      perDiemDomesticTaxFree: "TRAKT_INR",
      perDiemForeignTaxFree: "TRAKT_UTR",
      mileageTaxFree: "BIL_SKFRI",
      mileageTaxable: "BIL_SKPL",
    },
    approval: { requiredApprovals: 1 },
    foreignNormalOverrides: {},
  };
}
