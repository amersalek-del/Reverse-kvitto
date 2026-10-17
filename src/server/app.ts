import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { buildVouchers, type Voucher } from "../core/accounting.ts";
import { ACCOUNT_NAMES } from "../core/defaults.ts";
import { calculateMileage } from "../core/mileage.ts";
import type { Employee, Report, Settings } from "../core/model.ts";
import { buildPayrollLines, payrollCsv, type PayrollLine } from "../core/payroll.ts";
import { KNOWN_YEARS, ratesFor } from "../core/rates.ts";
import { parseReceiptText } from "../core/receipt-parser.ts";
import { reportTotal, summarizeReport } from "../core/report.ts";
import { encodeCp437, toSie } from "../core/sie.ts";
import { calculatePerDiem } from "../core/traktamente.ts";
import { ValidationError, validateEntry } from "../core/validate.ts";
import { approve, canApprove, isEditable, markExported, reject, resolveApprovers, submit, WorkflowError } from "../core/workflow.ts";
import { authorizeUrl, FortnoxClient, requestToken, type FetchLike } from "../fortnox/client.ts";
import type { Store } from "./store.ts";

export interface AppOptions {
  publicDir: string;
  fortnox?: { clientId: string; clientSecret: string; redirectUri: string };
  fetch?: FetchLike;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_UPLOAD = 15 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"];

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Filen är för stor");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, 1024 * 1024);
  if (body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Ogiltig JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, name: string, contentType: string, data: Uint8Array | string): void {
  res.writeHead(200, { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${name}"` });
  res.end(data);
}

export function createApp(store: Store, options: AppOptions) {
  const db = () => store.db;
  const oauthStates = new Set<string>();

  function currentUser(req: IncomingMessage): Employee {
    // Demo authentication: the UI picks a user. Put real SSO in front of this in production.
    const id = req.headers["x-user-id"];
    const user = db().employees.find((e) => e.id === id);
    if (!user) throw new HttpError(401, "Okänd användare");
    return user;
  }

  function requireAdmin(user: Employee): void {
    if (user.role !== "admin") throw new HttpError(403, "Kräver administratör");
  }

  function org() {
    return { employees: db().employees, departments: db().departments, settings: db().settings };
  }

  function findReport(id: string, user: Employee): Report {
    const report = db().reports.find((r) => r.id === id);
    if (!report) throw new HttpError(404, "Rapporten finns inte");
    const owner = db().employees.find((e) => e.id === report.employeeId);
    const isApprover = owner ? resolveApprovers(owner, org()).some((e) => e.id === user.id) : false;
    if (report.employeeId !== user.id && user.role !== "admin" && !isApprover) throw new HttpError(403, "Ingen behörighet");
    return report;
  }

  function ownerOf(report: Report): Employee {
    const owner = db().employees.find((e) => e.id === report.employeeId);
    if (!owner) throw new HttpError(500, "Rapportens ägare saknas");
    return owner;
  }

  function exportsFor(report: Report): { vouchers: Voucher[]; payroll: PayrollLine[] } {
    const settings = db().settings;
    const summary = summarizeReport(report, settings);
    const owner = ownerOf(report);
    return { vouchers: buildVouchers(report, summary, owner.name, settings), payroll: buildPayrollLines(owner, summary, settings) };
  }

  function reportView(report: Report, user: Employee) {
    const settings = db().settings;
    const summary = summarizeReport(report, settings);
    const total = reportTotal(summary);
    const owner = ownerOf(report);
    const { vouchers, payroll } = exportsFor(report);
    return {
      report,
      owner: { id: owner.id, name: owner.name },
      summary,
      total,
      canEdit: isEditable(report) && report.employeeId === user.id,
      canApprove: canApprove(report, user, total, org()),
      canExport: report.status === "approved" && user.role === "admin",
      approvers: resolveApprovers(owner, org()).map((e) => ({ id: e.id, name: e.name, approvalLimit: e.approvalLimit ?? null })),
      vouchers,
      payroll,
    };
  }

  function listItem(report: Report) {
    const summary = summarizeReport(report, db().settings);
    return {
      id: report.id,
      title: report.title,
      status: report.status,
      employeeId: report.employeeId,
      employeeName: ownerOf(report).name,
      entries: report.entries.length,
      total: reportTotal(summary),
      toEmployee: summary.totals.toEmployee,
      createdAt: report.createdAt,
      submittedAt: report.submittedAt ?? null,
      warnings: summary.warnings.length,
    };
  }

  async function fortnoxClient(): Promise<FortnoxClient | null> {
    const conn = db().fortnox;
    if (!conn || !options.fortnox) return null;
    if (Date.parse(conn.expiresAt) - 60_000 < Date.now()) {
      const token = await requestToken(options.fortnox.clientId, options.fortnox.clientSecret, { refreshToken: conn.refreshToken }, options.fetch);
      db().fortnox = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
      store.save();
    }
    return new FortnoxClient({ accessToken: db().fortnox!.accessToken, ...(options.fetch ? { fetch: options.fetch } : {}) });
  }

  async function exportReport(report: Report, user: Employee) {
    const { vouchers, payroll } = exportsFor(report);
    const client = await fortnoxClient();
    const booked: { series: string; number?: number }[] = [];
    if (client) {
      for (const voucher of vouchers) {
        const created = await client.createVoucher(voucher);
        booked.push({ series: created.series, number: created.number });
        // Attach the receipt images ("kvittobilder") to the voucher, like Kvitto & Resa does.
        const attachmentIds = report.entries.filter((e) => voucher.entryIds.includes(e.id) && e.kind === "receipt").flatMap((e) => (e.kind === "receipt" ? e.attachmentIds : []));
        for (const id of attachmentIds) {
          const meta = db().attachments.find((a) => a.id === id);
          if (!meta) continue;
          const fileId = await client.uploadToInbox(meta.name, store.readAttachment(id), meta.contentType);
          await client.attachFileToVoucher(fileId, created.series, created.number);
        }
      }
      for (const line of payroll) await client.createSalaryTransaction(line);
    } else {
      booked.push(...vouchers.map((v) => ({ series: v.series })));
    }
    markExported(report, user, { vouchers: booked, payrollLines: payroll.length, at: new Date().toISOString() });
    store.save();
    return { sentToFortnox: !!client, vouchers: booked, payrollLines: payroll.length };
  }

  async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(options.publicDir, rel);
    if (!file.startsWith(options.publicDir)) throw new HttpError(404, "Hittades inte");
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      throw new HttpError(404, "Hittades inte");
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean);

    if (!path.startsWith("/api/")) return serveStatic(path, res);

    // Endpoints that do not need a user.
    if (method === "GET" && path === "/api/users") {
      return send(res, 200, db().employees.map((e) => ({ id: e.id, name: e.name, role: e.role })));
    }
    if (method === "GET" && path === "/api/fortnox/callback") {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code");
      if (!options.fortnox || !code || !oauthStates.delete(state)) throw new HttpError(400, "Ogiltigt svar från Fortnox");
      const token = await requestToken(options.fortnox.clientId, options.fortnox.clientSecret, { code, redirectUri: options.fortnox.redirectUri }, options.fetch);
      db().fortnox = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
      store.save();
      res.writeHead(302, { Location: "/#installningar" });
      return void res.end();
    }

    const user = currentUser(req);

    if (method === "GET" && path === "/api/bootstrap") {
      const year = new Date().getFullYear();
      return send(res, 200, {
        me: user,
        employees: db().employees,
        departments: db().departments,
        settings: db().settings,
        rates: ratesFor(year),
        accountNames: ACCOUNT_NAMES,
        fortnox: { configured: !!options.fortnox, connected: !!db().fortnox },
      });
    }

    if (method === "GET" && path === "/api/rates") {
      const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
      return send(res, 200, { ...ratesFor(year), knownYears: KNOWN_YEARS });
    }

    if (method === "POST" && path === "/api/calc/traktamente") {
      const body = await readJson(req);
      const entry = validateEntry("calc", { kind: "trip", purpose: "-", destination: "-", trip: body }, db().settings);
      if (entry.kind !== "trip") throw new HttpError(400, "Ogiltig resa");
      try {
        return send(res, 200, calculatePerDiem({ ...entry.trip, foreignOverrides: db().settings.foreignNormalOverrides }));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    if (method === "POST" && path === "/api/calc/mileage") {
      const body = await readJson(req);
      const entry = validateEntry("calc", { from: "-", to: "-", purpose: "-", ...body, kind: "mileage" }, db().settings);
      if (entry.kind !== "mileage") throw new HttpError(400, "Ogiltig resa");
      try {
        return send(res, 200, calculateMileage(entry));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }

    if (method === "POST" && path === "/api/receipts/parse") {
      const body = await readJson(req);
      if (typeof body.text !== "string") throw new HttpError(400, "Text saknas");
      return send(res, 200, parseReceiptText(body.text, db().settings.categories));
    }

    // Settings and organisation ("Min organisation"), admin only.
    if (method === "PUT" && path === "/api/settings") {
      requireAdmin(user);
      const body = await readJson(req);
      const current = db().settings;
      const next: Settings = { ...current, ...(body as Partial<Settings>) };
      if (!Array.isArray(next.categories) || next.categories.length === 0) throw new HttpError(400, "Minst en kategori krävs");
      db().settings = next;
      store.save();
      return send(res, 200, next);
    }
    if (parts[1] === "employees" && (method === "POST" || method === "PUT")) {
      requireAdmin(user);
      const body = await readJson(req);
      if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "Namn saknas");
      if (typeof body.employeeNumber !== "string" || !body.employeeNumber.trim()) throw new HttpError(400, "Anställningsnummer saknas");
      const role = body.role === "admin" || body.role === "approver" ? body.role : "employee";
      const fields: Employee = {
        id: method === "POST" ? store.newId() : parts[2]!,
        name: body.name.trim(),
        employeeNumber: body.employeeNumber.trim(),
        role,
        ...(typeof body.email === "string" && body.email ? { email: body.email } : {}),
        ...(typeof body.departmentId === "string" && body.departmentId ? { departmentId: body.departmentId } : {}),
        ...(typeof body.approverId === "string" && body.approverId ? { approverId: body.approverId } : {}),
        ...(typeof body.approvalLimit === "number" ? { approvalLimit: body.approvalLimit } : {}),
      };
      if (method === "POST") db().employees.push(fields);
      else {
        const idx = db().employees.findIndex((e) => e.id === parts[2]);
        if (idx < 0) throw new HttpError(404, "Användaren finns inte");
        db().employees[idx] = fields;
      }
      store.save();
      return send(res, method === "POST" ? 201 : 200, fields);
    }
    if (parts[1] === "departments" && (method === "POST" || method === "PUT")) {
      requireAdmin(user);
      const body = await readJson(req);
      if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "Namn saknas");
      const approverIds = Array.isArray(body.approverIds) ? body.approverIds.filter((x): x is string => typeof x === "string") : [];
      const department = { id: method === "POST" ? store.newId() : parts[2]!, name: body.name.trim(), approverIds };
      if (method === "POST") db().departments.push(department);
      else {
        const idx = db().departments.findIndex((d) => d.id === parts[2]);
        if (idx < 0) throw new HttpError(404, "Avdelningen finns inte");
        db().departments[idx] = department;
      }
      store.save();
      return send(res, method === "POST" ? 201 : 200, department);
    }

    // Attachments ("kvittobilder").
    if (method === "POST" && path === "/api/attachments") {
      const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      if (!UPLOAD_TYPES.includes(contentType)) throw new HttpError(415, "Endast bilder och PDF kan laddas upp");
      const data = await readBody(req, MAX_UPLOAD);
      if (data.length === 0) throw new HttpError(400, "Tom fil");
      const name = (url.searchParams.get("name") ?? "kvitto").replace(/[^\w.\-åäöÅÄÖ ]/g, "_").slice(0, 100);
      const attachment = store.saveAttachment({ name, contentType, ownerId: user.id }, data);
      return send(res, 201, attachment);
    }
    if (method === "GET" && parts[1] === "attachments" && parts[2]) {
      const meta = db().attachments.find((a) => a.id === parts[2]);
      if (!meta) throw new HttpError(404, "Bilagan finns inte");
      if (meta.ownerId !== user.id && user.role === "employee") throw new HttpError(403, "Ingen behörighet");
      res.writeHead(200, { "Content-Type": meta.contentType, "Cache-Control": "private, max-age=3600" });
      return void res.end(store.readAttachment(meta.id));
    }

    // Fortnox connection.
    if (method === "GET" && path === "/api/fortnox/connect") {
      requireAdmin(user);
      if (!options.fortnox) throw new HttpError(400, "FORTNOX_CLIENT_ID och FORTNOX_CLIENT_SECRET är inte satta");
      const state = randomBytes(16).toString("hex");
      oauthStates.add(state);
      return send(res, 200, { url: authorizeUrl(options.fortnox.clientId, options.fortnox.redirectUri, state) });
    }
    if (method === "POST" && path === "/api/fortnox/sync") {
      requireAdmin(user);
      const client = await fortnoxClient();
      if (!client) throw new HttpError(400, "Inte ansluten till Fortnox");
      return send(res, 200, await client.fetchRegisters());
    }

    // Reports.
    if (parts[1] === "reports") {
      if (method === "GET" && parts.length === 2) {
        const scope = url.searchParams.get("scope") ?? "mine";
        let reports = db().reports;
        if (scope === "mine") reports = reports.filter((r) => r.employeeId === user.id);
        else if (scope === "todo") reports = reports.filter((r) => canApprove(r, user, reportTotal(summarizeReport(r, db().settings)), org()));
        else if (scope === "all") {
          requireAdmin(user);
        } else throw new HttpError(400, "Okänt urval");
        return send(res, 200, reports.map(listItem).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }
      if (method === "POST" && parts.length === 2) {
        const body = await readJson(req);
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : `Utlägg ${new Date().toISOString().slice(0, 10)}`;
        const now = new Date().toISOString();
        const report: Report = { id: store.newId(), employeeId: user.id, title, status: "draft", entries: [], approvals: [], history: [{ at: now, by: user.id, action: "created" }], createdAt: now };
        db().reports.push(report);
        store.save();
        return send(res, 201, reportView(report, user));
      }

      const report = findReport(parts[2]!, user);
      const action = parts[3];
      const total = () => reportTotal(summarizeReport(report, db().settings));
      const requireEditable = () => {
        if (report.employeeId !== user.id) throw new HttpError(403, "Endast ägaren kan ändra rapporten");
        if (!isEditable(report)) throw new HttpError(409, "Rapporten är låst efter inskickning");
      };

      if (method === "GET" && !action) return send(res, 200, reportView(report, user));
      if (method === "PATCH" && !action) {
        requireEditable();
        const body = await readJson(req);
        if (typeof body.title === "string" && body.title.trim()) report.title = body.title.trim();
        store.save();
        return send(res, 200, reportView(report, user));
      }
      if (method === "DELETE" && !action) {
        requireEditable();
        db().reports = db().reports.filter((r) => r.id !== report.id);
        store.save();
        return send(res, 200, { ok: true });
      }
      if (action === "entries") {
        requireEditable();
        const entryId = parts[4];
        let entries = report.entries;
        if (method === "POST" && !entryId) {
          entries = [...entries, validateEntry(store.newId(), await readJson(req), db().settings)];
        } else if (method === "PUT" && entryId) {
          if (!entries.some((e) => e.id === entryId)) throw new HttpError(404, "Posten finns inte");
          const entry = validateEntry(entryId, await readJson(req), db().settings);
          entries = entries.map((e) => (e.id === entryId ? entry : e));
        } else if (method === "DELETE" && entryId) {
          entries = entries.filter((e) => e.id !== entryId);
        } else throw new HttpError(405, "Metoden stöds inte");
        // Run the calculations before saving so rule errors (e.g. return before departure) are rejected.
        try {
          summarizeReport({ ...report, entries }, db().settings);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        report.entries = entries;
        store.save();
        return send(res, 200, reportView(report, user));
      }
      if (method === "POST" && action === "submit") {
        submit(report, user);
        store.save();
        return send(res, 200, reportView(report, user));
      }
      if (method === "POST" && action === "approve") {
        approve(report, user, total(), org());
        store.save();
        return send(res, 200, reportView(report, user));
      }
      if (method === "POST" && action === "reject") {
        const body = await readJson(req);
        reject(report, user, total(), org(), typeof body.comment === "string" ? body.comment : "");
        store.save();
        return send(res, 200, reportView(report, user));
      }
      if (method === "POST" && action === "export") {
        if (report.status !== "approved") throw new HttpError(409, "Endast attesterade rapporter kan överföras");
        requireAdmin(user);
        const result = await exportReport(report, user);
        return send(res, 200, { ...result, view: reportView(report, user) });
      }
      if (method === "GET" && action === "sie") {
        const { vouchers } = exportsFor(report);
        const sie = toSie(vouchers, {
          companyName: db().settings.companyName,
          organisationNumber: db().settings.organisationNumber,
          generatedOn: new Date().toISOString().slice(0, 10),
          accountNames: ACCOUNT_NAMES,
        });
        return sendFile(res, `utlagg-${report.id.slice(0, 8)}.se`, "application/octet-stream", encodeCp437(sie));
      }
      if (method === "GET" && action === "payroll.csv") {
        return sendFile(res, `lon-${report.id.slice(0, 8)}.csv`, "text/csv; charset=utf-8", "﻿" + payrollCsv(exportsFor(report).payroll));
      }
    }

    throw new HttpError(404, "Hittades inte");
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(req, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ValidationError ? 400 : e instanceof WorkflowError ? 409 : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? "Internt fel" : (e as Error).message });
      else res.end();
    }
  };
}
