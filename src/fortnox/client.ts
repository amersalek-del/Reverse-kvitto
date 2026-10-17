import type { Voucher } from "../core/accounting.ts";
import type { Ore } from "../core/money.ts";
import type { PayrollLine } from "../core/payroll.ts";

// Minimal client for Fortnox's public REST API (https://api.fortnox.se/3),
// covering what Kvitto & Resa's integration does: create vouchers in
// Bokföring, attach receipt images to them, and post salary transactions to Lön.
// Authentication is OAuth 2 (authorization code flow) with a Bearer token.

export const FORTNOX_API = "https://api.fortnox.se/3";
export const FORTNOX_AUTH = "https://apps.fortnox.se/oauth-v1";
/** Scopes the integration needs: bookkeeping, payroll, file inbox and the registers it reads. */
export const SCOPES = ["bookkeeping", "salary", "inbox", "archive", "costcenter", "project", "companyinformation"];

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | FormData }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface FortnoxClientOptions {
  accessToken: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Pause before retrying after HTTP 429; Fortnox allows 25 requests per 5 seconds. */
  retryDelayMs?: number;
}

export class FortnoxError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const info = (body as { ErrorInformation?: { message?: string; Message?: string } } | undefined)?.ErrorInformation;
    super(`Fortnox ${status}: ${info?.message ?? info?.Message ?? JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

const toKr = (ore: Ore) => Math.round(ore) / 100;

export function voucherPayload(voucher: Voucher) {
  return {
    Voucher: {
      Description: voucher.description,
      TransactionDate: voucher.transactionDate,
      VoucherSeries: voucher.series,
      VoucherRows: voucher.rows.map((r) => ({
        Account: Number(r.account),
        Debit: toKr(r.debit),
        Credit: toKr(r.credit),
        ...(r.costCenter ? { CostCenter: r.costCenter } : {}),
        ...(r.project ? { Project: r.project } : {}),
        ...(r.text ? { TransactionInformation: r.text.slice(0, 100) } : {}),
      })),
    },
  };
}

export function salaryTransactionPayload(line: PayrollLine) {
  return {
    SalaryTransaction: {
      EmployeeId: line.employeeNumber,
      SalaryCode: line.salaryCode,
      Date: line.date,
      Number: line.quantity,
      Amount: toKr(line.rate),
      TextRow: line.text.slice(0, 50),
      ...(line.costCenter ? { CostCenter: line.costCenter } : {}),
      ...(line.project ? { Project: line.project } : {}),
    },
  };
}

export class FortnoxClient {
  private readonly token: string;
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly retryDelayMs: number;

  constructor(options: FortnoxClientOptions) {
    this.token = options.accessToken;
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.baseUrl = options.baseUrl ?? FORTNOX_API;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
  }

  private async request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${this.baseUrl}${path}`, { method, headers, ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
        continue;
      }
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : {};
      if (!res.ok) throw new FortnoxError(res.status, parsed);
      return parsed as T;
    }
  }

  async createVoucher(voucher: Voucher): Promise<{ series: string; number: number; year?: number }> {
    const res = await this.request<{ Voucher: { VoucherSeries: string; VoucherNumber: number; Year?: number } }>("POST", "/vouchers", voucherPayload(voucher));
    return { series: res.Voucher.VoucherSeries, number: res.Voucher.VoucherNumber, ...(res.Voucher.Year !== undefined ? { year: res.Voucher.Year } : {}) };
  }

  /** Uploads a file to the voucher inbox ("Inkorg – Verifikationer") and returns its file id. */
  async uploadToInbox(name: string, data: Uint8Array, contentType: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([data as Uint8Array<ArrayBuffer>], { type: contentType }), name);
    const res = await this.request<{ File: { Id: string } }>("POST", "/inbox?path=inbox_v", undefined, form);
    return res.File.Id;
  }

  async attachFileToVoucher(fileId: string, series: string, number: number): Promise<void> {
    await this.request("POST", "/voucherfileconnections", { VoucherFileConnection: { FileId: fileId, VoucherNumber: String(number), VoucherSeries: series } });
  }

  async createSalaryTransaction(line: PayrollLine): Promise<number> {
    const res = await this.request<{ SalaryTransaction: { SalaryRow: number } }>("POST", "/salarytransactions", salaryTransactionPayload(line));
    return res.SalaryTransaction.SalaryRow;
  }

  /** "Hämta senaste data från Fortnox": registers the settings screen chooses from. */
  async fetchRegisters(): Promise<{ accounts: { number: string; name: string }[]; costCenters: string[]; projects: string[]; voucherSeries: string[] }> {
    const [accounts, costCenters, projects, series] = await Promise.all([
      this.request<{ Accounts: { Number: number; Description: string }[] }>("GET", "/accounts?limit=500"),
      this.request<{ CostCenters: { Code: string }[] }>("GET", "/costcenters"),
      this.request<{ Projects: { ProjectNumber: string }[] }>("GET", "/projects"),
      this.request<{ VoucherSeriesCollection: { Code: string; Manual?: boolean }[] }>("GET", "/voucherseries"),
    ]);
    return {
      accounts: accounts.Accounts.map((a) => ({ number: String(a.Number), name: a.Description })),
      costCenters: costCenters.CostCenters.map((c) => c.Code),
      projects: projects.Projects.map((p) => p.ProjectNumber),
      // Like Kvitto & Resa, only series marked for manual registration can be used.
      voucherSeries: series.VoucherSeriesCollection.filter((s) => s.Manual !== false).map((s) => s.Code),
    };
  }
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    response_type: "code",
  });
  return `${FORTNOX_AUTH}/auth?${params}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** Exchanges an authorization code, or refreshes a token, at Fortnox's token endpoint. */
export async function requestToken(
  clientId: string,
  clientSecret: string,
  grant: { code: string; redirectUri: string } | { refreshToken: string },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TokenResponse> {
  const body =
    "code" in grant
      ? new URLSearchParams({ grant_type: "authorization_code", code: grant.code, redirect_uri: grant.redirectUri })
      : new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refreshToken });
  const res = await fetchImpl(`${FORTNOX_AUTH}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new FortnoxError(res.status, json);
  return json as TokenResponse;
}
