import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { FetchLike } from "../src/fortnox/client.ts";
import { createApp } from "../src/server/app.ts";
import { Store } from "../src/server/store.ts";

const fortnoxCalls: { url: string; body: unknown }[] = [];
let voucherNumber = 100;
const fakeFortnox: FetchLike = async (url, init) => {
  const body = typeof init.body === "string" ? (url.endsWith("/token") ? init.body : JSON.parse(init.body)) : "form-data";
  fortnoxCalls.push({ url, body });
  let response: unknown = {};
  if (url.endsWith("/vouchers")) response = { Voucher: { VoucherSeries: "A", VoucherNumber: ++voucherNumber } };
  else if (url.includes("/inbox")) response = { File: { Id: "file-1" } };
  else if (url.endsWith("/salarytransactions")) response = { SalaryTransaction: { SalaryRow: 1 } };
  return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) };
};

let server: Server;
let base: string;
const store = new Store(null);

before(async () => {
  store.db.fortnox = { accessToken: "token", refreshToken: "refresh", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const app = createApp(store, {
    publicDir: join(import.meta.dirname, "../public"),
    fortnox: { clientId: "id", clientSecret: "secret", redirectUri: "http://localhost/cb" },
    fetch: fakeFortnox,
  });
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

async function api(user: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "X-User-Id": user, ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: body instanceof Uint8Array ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

test("full flow: receipts, mileage and per diem through attest to Fortnox", async () => {
  const upload = await api("anna", "POST", "/api/attachments?name=kvitto.jpg", new Uint8Array([0xff, 0xd8, 0xff]), { "Content-Type": "image/jpeg" });
  assert.equal(upload.status, 201);

  const created = await api("anna", "POST", "/api/reports", { title: "Kundbesök Göteborg" });
  assert.equal(created.status, 201);
  const id = created.json.report.id;

  const fuel = await api("anna", "POST", `/api/reports/${id}/entries`, {
    kind: "receipt",
    date: "2026-10-12",
    merchant: "Circle K",
    categoryId: "fuel",
    amount: 90473,
    vatRate: 25,
    payment: "private",
    attachmentIds: [upload.json.id],
    project: "P100",
  });
  assert.equal(fuel.status, 200, JSON.stringify(fuel.json));

  await api("anna", "POST", `/api/reports/${id}/entries`, {
    kind: "receipt",
    date: "2026-10-13",
    merchant: "Restaurang Pelikan",
    categoryId: "rep_external",
    amount: 168000,
    vatRate: 12,
    payment: "company_card",
    attachmentIds: [],
    representation: { kind: "meal_food_only", attendees: ["Anna Andersson", "Kund A", "Kund B"], purpose: "Avtalsförhandling" },
  });
  await api("anna", "POST", `/api/reports/${id}/entries`, { kind: "mileage", date: "2026-10-12", from: "Stockholm", to: "Göteborg", purpose: "Kundbesök", km: 470, vehicle: "own_car" });
  const withTrip = await api("anna", "POST", `/api/reports/${id}/entries`, {
    kind: "trip",
    purpose: "Kundbesök",
    destination: "Göteborg",
    trip: { departure: "2026-10-12T07:00", return: "2026-10-13T18:00", country: "SE", distanceKm: 470, freeMeals: { "2026-10-13": { lunch: true } } },
  });
  assert.equal(withTrip.status, 200);
  const t = withTrip.json.summary.totals;
  assert.equal(t.privateOutlays, 90473);
  assert.equal(t.companyCard, 168000);
  assert.equal(t.mileageTaxFree, 117500);
  assert.equal(t.perDiemDomestic, 30000 + 15000 - 5300);

  // Representation: 1500 kr net for 3 persons is above the cap, so VAT is limited to 3 × 36 kr.
  const rep = withTrip.json.summary.receipts.find((r: any) => r.entry.merchant === "Restaurang Pelikan");
  assert.equal(rep.deductibleVat, 10800);
  assert.equal(rep.costAccount, "6072");

  // A bad trip is rejected without changing the report.
  const bad = await api("anna", "POST", `/api/reports/${id}/entries`, { kind: "trip", purpose: "x", destination: "x", trip: { departure: "2026-10-12T07:00", return: "2026-10-11T07:00", country: "SE" } });
  assert.equal(bad.status, 400);

  assert.equal((await api("anna", "POST", `/api/reports/${id}/submit`)).json.report.status, "submitted");
  assert.equal((await api("anna", "POST", `/api/reports/${id}/entries`, { kind: "mileage" })).status, 409);

  // Anna cannot approve her own report; Erik (department approver) can.
  assert.equal((await api("anna", "POST", `/api/reports/${id}/approve`)).status, 409);
  const todo = await api("erik", "GET", "/api/reports?scope=todo");
  assert.deepEqual(todo.json.map((r: any) => r.id), [id]);
  const approved = await api("erik", "POST", `/api/reports/${id}/approve`);
  assert.equal(approved.json.report.status, "approved");

  // Preview of the bookkeeping: one balanced voucher.
  const view = approved.json;
  assert.equal(view.vouchers.length, 1);
  const rows = view.vouchers[0].rows;
  const debit = rows.reduce((s: number, r: any) => s + r.debit, 0);
  const credit = rows.reduce((s: number, r: any) => s + r.credit, 0);
  assert.equal(debit, credit);
  assert.deepEqual(rows.find((r: any) => r.account === "5611"), { account: "5611", debit: 72378, credit: 0, text: "Circle K", project: "P100" });

  const sie = await api("maria", "GET", `/api/reports/${id}/sie`);
  assert.match(sie.text, /#VER "A" "" 20261013/);
  assert.match(sie.text, /#TRANS 5611 \{6 "P100"\} 723\.78/);

  const csv = await api("maria", "GET", `/api/reports/${id}/payroll.csv`);
  assert.match(csv.text, /1;UTLAGG;2026-10-12;1;904,73;904,73/);
  assert.match(csv.text, /1;BIL_SKFRI;2026-10-12;47;25,00;1175,00/);

  // Only admins export.
  assert.equal((await api("erik", "POST", `/api/reports/${id}/export`)).status, 403);
  const exported = await api("maria", "POST", `/api/reports/${id}/export`);
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  assert.equal(exported.json.sentToFortnox, true);
  assert.deepEqual(exported.json.vouchers, [{ series: "A", number: 101 }]);
  assert.equal(exported.json.view.report.status, "exported");

  const urls = fortnoxCalls.map((c) => c.url.replace("https://api.fortnox.se/3", ""));
  assert.deepEqual(urls, ["/vouchers", "/inbox?path=inbox_v", "/voucherfileconnections", "/salarytransactions", "/salarytransactions", "/salarytransactions"]);
  const voucherBody = fortnoxCalls[0]!.body as any;
  assert.equal(voucherBody.Voucher.VoucherSeries, "A");
  assert.ok(voucherBody.Voucher.VoucherRows.some((r: any) => r.Account === 2641 && r.Debit === 288.95));
});

test("rejection sends the report back for editing", async () => {
  const id = (await api("anna", "POST", "/api/reports", { title: "Fel" })).json.report.id;
  await api("anna", "POST", `/api/reports/${id}/entries`, { kind: "mileage", date: "2026-10-01", from: "A", to: "B", purpose: "Möte", km: 100 });
  await api("anna", "POST", `/api/reports/${id}/submit`);
  assert.equal((await api("erik", "POST", `/api/reports/${id}/reject`, { comment: "" })).status, 409);
  const rejected = await api("erik", "POST", `/api/reports/${id}/reject`, { comment: "Ange syfte" });
  assert.equal(rejected.json.report.status, "rejected");
  assert.equal((await api("anna", "POST", `/api/reports/${id}/entries`, { kind: "mileage", date: "2026-10-02", from: "B", to: "A", purpose: "Möte", km: 100 })).status, 200);
});

test("approval limit routes large reports past a limited approver", async () => {
  const id = (await api("anna", "POST", "/api/reports", { title: "Stort köp" })).json.report.id;
  await api("anna", "POST", `/api/reports/${id}/entries`, { kind: "receipt", date: "2026-10-01", merchant: "Webhallen", categoryId: "equipment", amount: 2_500_000, vatRate: 25, attachmentIds: [] });
  await api("anna", "POST", `/api/reports/${id}/submit`);
  // Erik may approve up to 20 000 kr; the admin can approve anything.
  assert.equal((await api("erik", "POST", `/api/reports/${id}/approve`)).status, 409);
  assert.equal((await api("maria", "POST", `/api/reports/${id}/approve`)).json.report.status, "approved");
});

test("employees cannot read other employees' reports or attachments", async () => {
  store.db.employees.push({ id: "olle", name: "Olle", employeeNumber: "9", role: "employee" });
  const id = (await api("anna", "POST", "/api/reports", { title: "Privat" })).json.report.id;
  assert.equal((await api("olle", "GET", `/api/reports/${id}`)).status, 403);
  assert.equal((await api("nobody", "GET", "/api/bootstrap")).status, 401);
});

test("receipt parsing and calculators", async () => {
  const parsed = await api("anna", "POST", "/api/receipts/parse", { text: "SJ AB\n2026-10-01\nTotalt 549,00\nMoms 6% 31,08" });
  assert.equal(parsed.json.total, 54900);
  assert.equal(parsed.json.categoryId, "travel");
  const per = await api("anna", "POST", "/api/calc/traktamente", { departure: "2026-10-01T08:00", return: "2026-10-02T20:00", country: "NO" });
  assert.equal(per.json.total, 2 * 105400);
  const mil = await api("anna", "POST", "/api/calc/mileage", { date: "2026-10-01", km: 10, vehicle: "company_car_fuel" });
  assert.equal(mil.json.taxFree, 1200);
});
