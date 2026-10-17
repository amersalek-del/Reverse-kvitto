# Fortnox Kvitto & Resa – reverse engineering notes

This is a **clean-room** reconstruction. It is based only on public material:
Fortnox and Findity product pages, help-centre articles, App Store listings,
Skatteverket's published rules and Fortnox's public API documentation. No app
binaries were decompiled and no private endpoints were probed. The goal is to
reproduce the *behaviour* (the business rules and the data that reaches
Fortnox), not the code.

## 1. What the product is

| Aspect | Finding |
| --- | --- |
| Vendor | Built and run by **Findity AB**. Since 2 May 2024 it is an *integration* in Fortnox, not a Fortnox-owned module; support moved to Findity. |
| Clients | Mobile app (iOS/Android) for capture, web app for reporting, attest and admin. Login uses Fortnox credentials. |
| Purpose | Employees report **utlägg** (receipts), **milersättning** (mileage) and **traktamente** (per diem). Approvers attest them. The result is booked in **Fortnox Bokföring** and/or paid via **Fortnox Lön**. |
| Price model | No integration fee to Fortnox; Findity charges per user. Fortnox's own, separate *Kvitto & Utlägg* product handles receipts only. |

## 2. Feature inventory and how this repo covers it

| Kvitto & Resa feature (public description) | This implementation |
| --- | --- |
| Photograph a receipt, the app reads it ("kvittotolkning") | Upload image/PDF. OCR runs in the browser (Tesseract.js, Swedish + English). The text goes through `src/core/receipt-parser.ts`, which pulls out merchant, org.nr (Luhn-checked), date, total, VAT lines (including `Moms% Moms Netto Brutto` tables), currency and a suggested category. |
| Categories with accounting per category | `src/core/categories.ts`: BAS accounts and VAT rates; editable under *Inställningar*. |
| Private payment vs company card | `payment: private / company_card`; credit account 2822 or the card account. |
| Foreign receipts and currency | Currency + exchange rate. Foreign VAT is never deducted; the whole amount goes to the foreign account (e.g. 5832). |
| Representation with attendees and purpose | Attendees and purpose are required. The VAT cap is applied (see §3.4) and the cost goes to 6071/6072 or 7631/7632. |
| Automatic mileage calculation | `src/core/mileage.ts`: own car, fuel company car, electric company car. Anything the company pays above the schablon is split out as taxable. |
| Per diem "in a few clicks" | `src/core/traktamente.ts`: full and half days, free meals, night allowance, foreign normalbelopp per country and day, long-term reductions. |
| Attest: specific person, default approver or department structure ("Min organisation"), amount limits per person, several approvers | `src/core/workflow.ts`: same resolution order, `approvalLimit`, `requiredApprovals`. Admins can always attest. You can't attest your own report. |
| Approver sees reports under *Att göra* | *Att attestera* view with a counter. |
| Reject with a comment, employee edits and resubmits | `rejected` status keeps the report editable and shows the comment. |
| Voucher series must be one marked for manual registration | Setting `voucherSeries`. The Fortnox sync filters series by `Manual`. |
| One voucher per report **or** one per expense on its own date | `voucherMode: per_report / per_entry`. |
| Report gets a voucher number, image follows as an attachment on the voucher | Export creates the voucher via `POST /3/vouchers`, uploads the images to the voucher inbox and links them with `voucherfileconnections`. The returned number is stored on the report. |
| Expenses and allowances flow into the payroll run | `src/core/payroll.ts` builds salary transactions (`POST /3/salarytransactions`) or a CSV file. |
| "Hämta senaste data från Fortnox" | `POST /api/fortnox/sync` reads accounts, cost centres, projects and voucher series. |
| Projects and cost centres on expenses | `project` / `costCenter` on every entry, passed to voucher rows, salary rows and SIE (dim 6 / dim 1). |

Not reproduced, either because nothing about them is public or because they are out of scope:

- **Native mobile apps.** The web UI is responsive and uses `capture="environment"` for the camera on phones.
- **Card transaction feeds** (Fortnox Företagskort/Mynt matching purchases to receipts).
- **Findity's server-side OCR.** It is replaced by in-browser OCR plus a deterministic text parser.
- **E-mail/push notifications and reminders.**
- **Fortnox Lön salary codes.** Every Fortnox company sets up its own *lönearter*, so the codes here are placeholders you map under *Inställningar*.

## 3. Business rules (inkomstår 2026)

All amounts are in `src/core/rates.ts` and are versioned by year.

### 3.1 Traktamente – domestic

| Rule | Value |
| --- | --- |
| Condition | Overnight stay, and the destination is **more than 50 km** from both home and the regular workplace |
| Full day | 300 kr |
| Half day | 150 kr. The departure day counts as half if you leave at **12:00 or later**; the return day if you are back at **19:00 or earlier** |
| Night allowance | 150 kr per night without employer-paid lodging |
| Long-term | After 3 months at the same location: 70 % (210 kr). After 2 years: 50 % (150 kr) |
| Free meals (percent of the day's maximum) | Breakfast 20 %, lunch 35 %, dinner 35 %. At 300 kr: 60 / 105 / 105, all three = 270. Rounded to whole kronor, so a lunch on a half day = 52.50 → 53 kr |

### 3.2 Traktamente – abroad

- The **normalbelopp** for the country where most of the day was spent is the full-day amount. The day's country can be set per date.
- Half days follow the same 12:00/19:00 rule (50 %). The night allowance is 50 % of the normalbelopp.
- Free meals: breakfast 15 %, lunch 35 %, dinner 35 % (all three = 85 %).
- 2026 normalbelopp included: DK 1 226, NO 1 054, FI 968, DE 760, GB 901, FR 850, ES 635, US 1 049. Unlisted countries use the general amount of 470 kr. More countries can be added with `foreignNormalOverrides`.

### 3.3 Milersättning

| Vehicle | Tax-free per mil |
| --- | --- |
| Own car | 25 kr |
| Company car, fossil fuel/hybrid | 12 kr |
| Company car, fully electric | 9.50 kr |

### 3.4 Representation (VAT)

- Cost per person ≤ 300 kr excl. VAT: the actual VAT is deductible.
- Above that, food only: at most 12 % × 300 = **36 kr per person**. Restaurant meals stay at 12 % after food VAT dropped to 6 % on 1 April 2026.
- Above that, with alcohol: Skatteverket's flat **46 kr per person**.
- Simpler refreshments (fika): fully deductible, and the cost is deductible as well (6071/7631).
- Meals are not deductible for income tax (6072/7632).

### 3.5 Bookkeeping (BAS)

```
Private receipt, 25 % VAT        Company card, 6 % VAT          Allowances in bookkeeping mode
D 5611 Drivmedel        net      D 5810 Biljetter       net     D 7321/7323 Traktamente
D 2641 Ingående moms    VAT      D 2641 Ingående moms   VAT     D 7331 Bilersättning skattefri
  K 2822 Reseräkningar  gross      K 2890 Kortskuld     gross   D 7332 Bilersättning skattepliktig
                                                                  K 2822 Reseräkningar
```

Fortnox Lön pays out what is on 2822 (the *UTLAGG* salary code). By default it also books the per diem and mileage cost when the salary run is posted, which is why those lines only appear on the expense voucher in *bookkeeping* mode. In that mode, set the per diem and mileage salary codes in Lön to book against 2822; otherwise the cost is booked twice.

## 4. Data flow to Fortnox (public API)

```
OAuth2  https://apps.fortnox.se/oauth-v1/auth   scopes: bookkeeping salary inbox archive costcenter project companyinformation
        https://apps.fortnox.se/oauth-v1/token  (authorization_code / refresh_token, Basic client auth)

Export of an approved report:
  POST /3/vouchers                 {"Voucher": {VoucherSeries, TransactionDate, Description, VoucherRows[{Account, Debit, Credit, CostCenter, Project, TransactionInformation}]}}
  POST /3/inbox?path=inbox_v       multipart file  -> File.Id
  POST /3/voucherfileconnections   {"VoucherFileConnection": {FileId, VoucherNumber, VoucherSeries}}
  POST /3/salarytransactions       {"SalaryTransaction": {EmployeeId, SalaryCode, Date, Number, Amount, TextRow, CostCenter, Project}}
```

Fortnox limits each token to about 25 requests per 5 seconds. The client retries on HTTP 429.

When no Fortnox app credentials are configured, the same data can be exported as an **SIE 4** file (PC8/CP437, importable under *Bokföring → Importera SIE*) and a **semicolon-separated salary file**.

## 5. Open questions to check against a real Fortnox account

1. The inbox folder parameter for vouchers (`path=inbox_v`). Fortnox's docs have used both `path` and `folderId` over time.
2. The exact field set of `/3/salarytransactions` on your Lön version (some versions want `Total` instead of `Number × Amount`).
3. Your company's salary codes for outlays, tax-free and taxable per diem, and mileage.
4. The full 2026 normalbelopp list for any countries you travel to beyond the ones included.

## Sources

- Fortnox – Kvitto & Resa product and integration pages: https://www.fortnox.se/produkt/fortnox-kvitto-resa, https://www.fortnox.se/integrationer/integration/findity-ab/kvitto-resa
- Fortnox help centre – settings, attest, getting started: https://fortnox.helpjuice.com/sv_SE/installningar-administrator/installningar-i-kvitto-resa, https://fortnox.helpjuice.com/sv_SE/kvitto-resa-anstalld/attestera-utlagg, https://support.fortnox.se/produkthjalp/lon/hantera-lonekorning-med-rapporter-fran-fortnox-kvitto-resa
- Findity – getting started: https://help.findity.com/sv_SE/kvitto-resa/kvitto-resa-hur-kommer-jag-igang
- App Store listing: https://apps.apple.com/se/app/kvitto-resa/id1323997452
- Skatteverket – SKV 354 utg. 36 (2026), amounts and percentages 2026, foreign per diem: https://www.skatteverket.se/download/18.1522bf3f19aea8075ba32f7/1765962793651/traktamenten-och-andra-kostnadsersattningar-skv354-utgava-36.pdf, https://www.skatteverket.se/privat/skatter/arbeteochinkomst/traktamente/utlandstraktamente.4.2b543913a42158acf800016035.html
- Skatteverket – VAT on representation: https://www.skatteverket.se/4.15532c7b1442f256baec84b.html
- Food VAT cut 1 April 2026: https://www.forvismazars.com/se/sv/insikter/nyhetsbrev-artiklar/artiklar-fraan-forvis-mazars-nyhetsbrev/en-tillfaellig-saenkning-av-moms-paa-livsmedel
- Normalbelopp 2026 compilation: https://bjornlunden.com/se/bjornkoll/blogg/utlandstraktamenten-och-normalbelopp/
