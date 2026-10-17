// Default expense categories ("utgiftstyper") with BAS 2026 accounts and Swedish VAT
// rates. Like in Kvitto & Resa, an administrator can change the list and the coding.

export interface Category {
  id: string;
  name: string;
  /** Cost account for purchases in Sweden. */
  account: string;
  /** Cost account for purchases abroad, if different. */
  foreignAccount?: string;
  /** Default VAT rate in percent. */
  vatRate: 0 | 6 | 12 | 25;
  /** Representation categories use separate accounts for deductible and non-deductible cost. */
  representation?: { deductibleAccount: string; nonDeductibleAccount: string };
  /** Lower-case words that suggest this category on a scanned receipt. */
  keywords: string[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "fuel",
    name: "Drivmedel",
    account: "5611",
    vatRate: 25,
    keywords: ["circle k", "preem", "okq8", "shell", "st1", "ingo", "tanka", "bensin", "diesel", "laddning", "e85"],
  },
  {
    id: "parking",
    name: "Parkering, vägtull och trängselskatt",
    account: "5890",
    vatRate: 25,
    keywords: ["parkering", "easypark", "aimo", "apcoa", "q-park", "parkster", "p-avgift"],
  },
  {
    id: "lodging",
    name: "Hotell och logi",
    account: "5831",
    foreignAccount: "5832",
    vatRate: 12,
    keywords: ["hotel", "hotell", "scandic", "elite", "radisson", "clarion", "quality", "best western", "first hotel", "nordic choice", "airbnb", "vandrarhem"],
  },
  {
    id: "travel",
    name: "Tåg, flyg och kollektivtrafik",
    account: "5810",
    vatRate: 6,
    keywords: ["sj ab", "sj ", "sas", "norwegian", "flygbussarna", "arlanda express", "västtrafik", "skånetrafiken", "sl ", "mtr", "vy ", "flixbus"],
  },
  {
    id: "taxi",
    name: "Taxi",
    account: "5810",
    vatRate: 6,
    keywords: ["taxi", "uber", "bolt", "cabonline", "sverigetaxi"],
  },
  {
    id: "car_rental",
    name: "Hyrbil",
    account: "5820",
    vatRate: 25,
    keywords: ["hertz", "avis", "europcar", "sixt", "budget", "mabi"],
  },
  {
    id: "office",
    name: "Kontorsmaterial",
    account: "6110",
    vatRate: 25,
    keywords: ["clas ohlson", "staples", "lyreco", "office depot", "papper", "toner"],
  },
  {
    id: "equipment",
    name: "Förbrukningsinventarier",
    account: "5410",
    vatRate: 25,
    keywords: ["elgiganten", "webhallen", "kjell", "netonnet", "ikea", "inet", "media markt"],
  },
  {
    id: "software",
    name: "Programvara och licenser",
    account: "5420",
    vatRate: 25,
    keywords: ["adobe", "microsoft", "google", "github", "jetbrains", "atlassian", "slack", "zoom", "dropbox"],
  },
  {
    id: "phone",
    name: "Telefon och internet",
    account: "6212",
    vatRate: 25,
    keywords: ["telia", "tele2", "telenor", "tre ", "comviq", "hallon", "bahnhof"],
  },
  {
    id: "literature",
    name: "Facklitteratur",
    account: "6970",
    vatRate: 6,
    keywords: ["adlibris", "bokus", "akademibokhandeln", "pocket shop"],
  },
  {
    id: "rep_external",
    name: "Extern representation",
    account: "6072",
    vatRate: 12,
    representation: { deductibleAccount: "6071", nonDeductibleAccount: "6072" },
    keywords: ["restaurang", "restaurant", "bistro", "brasserie", "krog", "trattoria", "sushi", "bar "],
  },
  {
    id: "rep_internal",
    name: "Intern representation",
    account: "7632",
    vatRate: 12,
    representation: { deductibleAccount: "7631", nonDeductibleAccount: "7632" },
    keywords: ["konditori", "café", "cafe", "espresso house", "wayne's"],
  },
  {
    id: "other",
    name: "Övrigt",
    account: "6990",
    vatRate: 25,
    keywords: [],
  },
];

export function findCategory(categories: Category[], id: string): Category {
  const category = categories.find((c) => c.id === id);
  if (!category) throw new Error(`Okänd kategori: ${id}`);
  return category;
}

/** Guesses a category from receipt text by keyword, falling back to "other". */
export function suggestCategory(categories: Category[], text: string): Category | undefined {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  let best: { category: Category; position: number } | undefined;
  for (const category of categories) {
    for (const keyword of category.keywords) {
      const position = haystack.indexOf(keyword);
      // Prefer the keyword that appears first: the merchant name heads the receipt.
      if (position >= 0 && (!best || position < best.position)) best = { category, position };
    }
  }
  return best?.category ?? categories.find((c) => c.id === "other");
}
