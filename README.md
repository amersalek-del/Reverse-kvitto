# Reverse Kvitto & Resa

A clean-room rebuild of **Fortnox Kvitto & Resa** (built by Findity AB) based on public documentation. Employees report receipts, mileage and per diem. Approvers attest them. The result is booked in Fortnox Bokföring and paid out through Fortnox Lön, either via the Fortnox API or as SIE and salary files.

See [`docs/reverse-engineering.md`](docs/reverse-engineering.md) for the product analysis, the 2026 tax rules with sources, the accounting model and what differs from the original.

## Features

- **Receipts (utlägg):** image or PDF upload, in-browser OCR and a receipt parser that pulls out the merchant, org.nr, date, total, VAT lines and a suggested category. Supports foreign currency, private payment vs company card, projects and cost centres.
- **Representation:** attendees and purpose are required, and the 300 kr/36 kr/46 kr VAT rules are applied.
- **Milersättning (mileage):** own car, fuel company car or electric company car. Anything above the tax-free rate is split out as taxable.
- **Traktamente (per diem):** domestic and foreign, half-day rules, meal reductions, night allowance, long-term reductions. Also available as a standalone calculator.
- **Attest:** specific approver, then department, then default approver. Supports approval limits, several required approvals, and rejection with a comment.
- **Export:**
  - Balanced vouchers, one per report or one per expense.
  - Salary transactions.
  - Fortnox API (OAuth2, vouchers, receipt images attached to vouchers, salary transactions).
  - SIE 4 file and salary CSV.

## Run

Requires Node.js 22.18 or later. TypeScript runs natively and there are no runtime dependencies.

```bash
npm install        # dev tools only (TypeScript, Node types)
npm start          # http://localhost:3000
npm test           # 29 tests: rules, parser, accounting, full API flow
npm run typecheck
```

The demo has three users, chosen from the top-right menu:

| User | Role |
| --- | --- |
| Anna | Employee |
| Erik | Department approver, limit 20 000 kr |
| Maria | Admin |

Data is stored in `./data` (`DATA_DIR` changes the location).

> The user switcher is demo authentication through the `X-User-Id` header. Put real SSO in front of the server before using it with real data.

### Connecting to Fortnox

1. Create an integration in the Fortnox developer portal with the redirect URI `${PUBLIC_URL}/api/fortnox/callback`.
2. Start with:
   ```bash
   FORTNOX_CLIENT_ID=... FORTNOX_CLIENT_SECRET=... PUBLIC_URL=https://your-host npm start
   ```
3. As admin, go to *Inställningar → Anslut till Fortnox*.
4. Map the salary codes (*lönearter*) to the ones in your Fortnox Lön.

## Layout

```
src/core/        Business rules (pure, no I/O)
  rates.ts         2026 schablon amounts from Skatteverket
  traktamente.ts   Per diem calculation
  mileage.ts       Mileage allowance
  representation.ts VAT on representation
  receipt-parser.ts Receipt text parsing
  report.ts        Report summary and warnings
  workflow.ts      Status, attest, approval limits
  accounting.ts    Vouchers (BAS)
  payroll.ts       Salary transactions and CSV
  sie.ts           SIE 4 export (PC8)
  validate.ts      Input validation
src/fortnox/     Fortnox API client (OAuth2, vouchers, inbox, salary)
src/server/      HTTP API and JSON storage
public/          Web UI (vanilla JS, Swedish)
test/            node:test suites
```
