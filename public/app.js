// Kvitto & Resa web client: vanilla JS, no build step. Amounts from the API are öre.

const state = { userId: localStorage.getItem("userId") || "anna", boot: null };
const $ = (sel, root = document) => root.querySelector(sel);
const main = $("#main");
const dialog = $("#dialog");
const dialogForm = $("#dialog-form");

const STATUS = { draft: "Utkast", submitted: "Väntar på attest", approved: "Attesterad", rejected: "Nekad", exported: "Överförd" };
const VEHICLES = { own_car: "Egen bil", company_car_fuel: "Förmånsbil (bensin/diesel/hybrid)", company_car_electric: "Förmånsbil (el)" };
const REP_KINDS = { meal_food_only: "Måltid utan alkohol", meal_with_alcohol: "Måltid med alkohol", simple_refreshments: "Enklare förtäring (fika)" };
const COUNTRIES = { SE: "Sverige", DK: "Danmark", NO: "Norge", FI: "Finland", DE: "Tyskland", GB: "Storbritannien", FR: "Frankrike", ES: "Spanien", US: "USA" };

// ---------- helpers ----------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function sek(ore) {
  return (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
}

function toOre(text) {
  const s = String(text).replace(/[\s ]/g, "").replace(",", ".");
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function oreToInput(ore) {
  return ore === undefined || ore === null ? "" : (ore / 100).toFixed(2).replace(".", ",");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3500);
}

async function api(method, path, body, raw) {
  const headers = { "X-User-Id": state.userId };
  let payload;
  if (raw) {
    payload = raw.data;
    headers["Content-Type"] = raw.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fel ${res.status}`);
  return data;
}

async function download(path) {
  const res = await fetch(path, { headers: { "X-User-Id": state.userId } });
  if (!res.ok) return toast("Kunde inte hämta filen");
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "export";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function employeeName(id) {
  return state.boot.employees.find((e) => e.id === id)?.name ?? id;
}

function category(id) {
  return state.boot.settings.categories.find((c) => c.id === id);
}

function statusBadge(status) {
  return `<span class="status ${esc(status)}">${esc(STATUS[status] ?? status)}</span>`;
}

function countryOptions(selected) {
  const known = Object.entries(COUNTRIES)
    .map(([code, name]) => `<option value="${code}" ${code === selected ? "selected" : ""}>${name}</option>`)
    .join("");
  const extra = selected && !COUNTRIES[selected] ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : "";
  return known + extra + `<option value="__other">Annat land…</option>`;
}

function openDialog(html, onSubmit) {
  dialogForm.innerHTML = html;
  dialog.showModal();
  const handler = async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    try {
      const done = await onSubmit(new FormData(dialogForm), event.submitter);
      if (done !== false) dialog.close();
    } catch (e) {
      const box = $(".dialog-error", dialogForm);
      if (box) {
        box.textContent = e.message;
        box.hidden = false;
      } else toast(e.message);
    }
  };
  dialogForm.onsubmit = handler;
}

const actions = (submitLabel = "Spara") => `
  <p class="notice error dialog-error" hidden></p>
  <div class="dialog-actions">
    <button value="cancel" formnovalidate>Avbryt</button>
    <button class="primary" value="save">${submitLabel}</button>
  </div>`;

// ---------- navigation ----------

async function boot() {
  const users = await fetch("/api/users").then((r) => r.json());
  if (!users.some((u) => u.id === state.userId)) state.userId = users[0]?.id;
  $("#user-select").innerHTML = users.map((u) => `<option value="${esc(u.id)}" ${u.id === state.userId ? "selected" : ""}>${esc(u.name)} (${esc(u.role)})</option>`).join("");
  $("#user-select").onchange = (e) => {
    state.userId = e.target.value;
    localStorage.setItem("userId", state.userId);
    location.hash = "#rapporter";
    reload();
  };
  await reload();
}

async function reload() {
  state.boot = await api("GET", "/api/bootstrap");
  await render();
}

async function renderNav() {
  const me = state.boot.me;
  let todoCount = 0;
  if (me.role !== "employee") todoCount = (await api("GET", "/api/reports?scope=todo")).length;
  const links = [
    ["#rapporter", "Mina rapporter"],
    ...(me.role !== "employee" ? [["#attestera", `Att attestera${todoCount ? ` <span class="badge">${todoCount}</span>` : ""}`]] : []),
    ...(me.role === "admin" ? [["#alla", "Alla rapporter"], ["#installningar", "Inställningar"]] : []),
    ["#kalkylator", "Traktamentskalkylator"],
  ];
  const current = location.hash.split("/")[0] || "#rapporter";
  $("#nav").innerHTML = links.map(([href, label]) => `<a href="${href}" class="${current === href ? "active" : ""}">${label}</a>`).join("");
}

async function render() {
  const [route, id] = (location.hash || "#rapporter").split("/");
  await renderNav();
  try {
    if (route === "#rapport" && id) await renderReport(id);
    else if (route === "#attestera") await renderList("todo", "Att attestera", "Rapporter som väntar på din attest.");
    else if (route === "#alla") await renderList("all", "Alla rapporter", "Samtliga rapporter i företaget.");
    else if (route === "#installningar") renderSettings();
    else if (route === "#kalkylator") renderCalculator();
    else await renderList("mine", "Mina rapporter", "Samla kvitton, milersättning och traktamente i en rapport och skicka in för attest.");
  } catch (e) {
    main.innerHTML = `<p class="notice error">${esc(e.message)}</p>`;
  }
  main.focus();
}

window.addEventListener("hashchange", render);

// ---------- report list ----------

async function renderList(scope, title, intro) {
  const reports = await api("GET", `/api/reports?scope=${scope}`);
  const rows = reports
    .map(
      (r) => `<tr class="clickable" data-id="${esc(r.id)}">
        <td><strong>${esc(r.title)}</strong>${scope !== "mine" ? `<div class="muted">${esc(r.employeeName)}</div>` : ""}</td>
        <td>${statusBadge(r.status)}${r.warnings ? ` <span class="muted" title="Varningar">⚠ ${r.warnings}</span>` : ""}</td>
        <td class="num hide-sm">${r.entries}</td>
        <td class="num">${sek(r.toEmployee)}</td>
        <td class="num hide-sm">${sek(r.total)}</td>
        <td class="hide-sm muted">${esc(r.createdAt.slice(0, 10))}</td>
      </tr>`,
    )
    .join("");
  main.innerHTML = `
    <div class="row spread">
      <div><h1>${esc(title)}</h1><p class="muted">${esc(intro)}</p></div>
      ${scope === "mine" ? `<button class="primary" id="new-report">+ Ny rapport</button>` : ""}
    </div>
    ${
      reports.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Rapport</th><th>Status</th><th class="num hide-sm">Poster</th><th class="num">Till anställd</th><th class="num hide-sm">Total kostnad</th><th class="hide-sm">Skapad</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : `<div class="card empty">${scope === "todo" ? "Inget att attestera just nu." : "Inga rapporter ännu."}</div>`
    }`;
  main.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = `#rapport/${tr.dataset.id}`)));
  const btn = $("#new-report");
  if (btn)
    btn.onclick = () =>
      openDialog(
        `<h2>Ny rapport</h2>
         <label>Namn<input name="title" required placeholder="t.ex. Kundbesök Göteborg oktober" autofocus /></label>
         ${actions("Skapa")}`,
        async (fd) => {
          const view = await api("POST", "/api/reports", { title: fd.get("title") });
          location.hash = `#rapport/${view.report.id}`;
        },
      );
}

// ---------- report detail ----------

function entryRows(view) {
  const { summary } = view;
  const rows = [];
  for (const line of summary.receipts) {
    const e = line.entry;
    const cat = category(e.categoryId);
    rows.push({
      id: e.id,
      date: e.date,
      what: `<strong>${esc(e.merchant)}</strong> ${esc(e.description)}<div class="muted">${esc(cat?.name ?? e.categoryId)} · konto ${esc(line.costAccount)}${
        e.payment === "company_card" ? " · företagskort" : ""
      }${e.currency !== "SEK" ? ` · ${oreToInput(e.amount)} ${esc(e.currency)}` : ""}${e.attachmentIds.length ? ` · <a href="#" data-attachment="${esc(e.attachmentIds[0])}">kvittobild</a>` : ""}</div>`,
      vat: line.deductibleVat,
      amount: line.grossSek,
    });
  }
  for (const { entry: e, result } of summary.mileage) {
    rows.push({
      id: e.id,
      date: e.date,
      what: `<strong>Milersättning</strong> ${esc(e.from)} – ${esc(e.to)}<div class="muted">${esc(e.purpose)} · ${e.km} km · ${esc(VEHICLES[e.vehicle])}${
        result.taxable ? ` · varav skattepliktigt ${sek(result.taxable)}` : ""
      }</div>`,
      vat: 0,
      amount: result.total,
    });
  }
  for (const { entry: e, result } of summary.trips) {
    const full = result.days.filter((d) => d.kind === "full").length;
    const half = result.days.length - full;
    rows.push({
      id: e.id,
      date: e.trip.departure.slice(0, 10),
      what: `<strong>Traktamente</strong> ${esc(e.destination)}<div class="muted">${esc(e.purpose)} · ${full} hela, ${half} halva dagar${
        result.nights.length ? `, ${result.nights.length} nätter` : ""
      } · ${esc(e.trip.departure.replace("T", " "))} – ${esc(e.trip.return.replace("T", " "))}</div>`,
      vat: 0,
      amount: result.total,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

async function renderReport(id) {
  const view = await api("GET", `/api/reports/${id}`);
  const { report, summary } = view;
  const t = summary.totals;
  const rows = entryRows(view);
  const lastReject = [...report.history].reverse().find((h) => h.action === "rejected");

  main.innerHTML = `
    <p><a href="#rapporter">← Tillbaka</a></p>
    <div class="row spread">
      <div>
        <h1>${esc(report.title)} ${statusBadge(report.status)}</h1>
        <p class="muted">${esc(view.owner.name)} · skapad ${esc(report.createdAt.slice(0, 10))}${
          view.approvers.length ? ` · attesteras av ${view.approvers.map((a) => esc(a.name)).join(" eller ")}` : ""
        }</p>
      </div>
      <div class="row">
        ${view.canEdit ? `<button id="rename">Byt namn</button><button class="danger" id="delete">Ta bort</button>` : ""}
      </div>
    </div>
    ${report.status === "rejected" && lastReject ? `<p class="notice error"><strong>Nekad av ${esc(employeeName(lastReject.by))}:</strong> ${esc(lastReject.comment)}</p>` : ""}
    ${summary.warnings.length ? `<div class="notice warn"><ul>${summary.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}

    <div class="grid">
      <div class="stat"><div class="label">Att betala ut</div><div class="value">${sek(t.toEmployee)}</div></div>
      <div class="stat"><div class="label">Utlägg (privat betalt)</div><div class="value">${sek(t.privateOutlays)}</div></div>
      <div class="stat"><div class="label">Företagskort</div><div class="value">${sek(t.companyCard)}</div></div>
      <div class="stat"><div class="label">Traktamente</div><div class="value">${sek(t.perDiemDomestic + t.perDiemForeign)}</div></div>
      <div class="stat"><div class="label">Milersättning</div><div class="value">${sek(t.mileageTaxFree + t.mileageTaxable)}</div></div>
    </div>

    <div class="row spread" style="margin-top:1.25rem">
      <h2 style="margin:0">Poster</h2>
      ${
        view.canEdit
          ? `<div class="row"><button class="primary" data-add="receipt">+ Kvitto</button><button data-add="mileage">+ Milersättning</button><button data-add="trip">+ Traktamente</button></div>`
          : ""
      }
    </div>
    ${
      rows.length
        ? `<div class="table-wrap" style="margin-top:.5rem"><table>
          <thead><tr><th>Datum</th><th>Beskrivning</th><th class="num hide-sm">Avdr. moms</th><th class="num">Belopp</th>${view.canEdit ? "<th></th>" : ""}</tr></thead>
          <tbody>${rows
            .map(
              (r) => `<tr><td>${esc(r.date)}</td><td>${r.what}</td><td class="num hide-sm">${r.vat ? sek(r.vat) : "–"}</td><td class="num">${sek(r.amount)}</td>${
                view.canEdit ? `<td class="num"><button class="link" data-edit="${esc(r.id)}">Ändra</button><button class="link" data-remove="${esc(r.id)}">Ta bort</button></td>` : ""
              }</tr>`,
            )
            .join("")}</tbody></table></div>`
        : `<div class="card empty" style="margin-top:.5rem">Lägg till kvitton, milersättning eller traktamente.</div>`
    }

    <div class="row" style="margin-top:1rem">
      ${view.canEdit && rows.length ? `<button class="primary" id="submit">Skicka in för attest</button>` : ""}
      ${view.canApprove ? `<button class="primary" id="approve">Attestera</button><button class="danger" id="reject">Neka</button>` : ""}
      ${view.canExport ? `<button class="primary" id="export">Överför till Fortnox</button>` : ""}
      ${state.boot.me.role === "admin" && rows.length ? `<button id="sie">Ladda ner SIE</button><button id="payroll">Ladda ner lönefil</button>` : ""}
    </div>

    ${voucherPreview(view)}
    ${payrollPreview(view)}

    <h2>Historik</h2>
    <div class="card"><ul style="margin:0;padding-left:1.2rem">${report.history
      .map((h) => `<li><span class="muted">${esc(h.at.slice(0, 16).replace("T", " "))}</span> ${esc(employeeName(h.by))}: ${esc(historyLabel(h.action))}${h.comment ? ` – ”${esc(h.comment)}”` : ""}</li>`)
      .join("")}${
      report.export
        ? `<li>Verifikationer: ${report.export.vouchers.map((v) => esc(v.series + (v.number ? " " + v.number : " (SIE)"))).join(", ")} · ${report.export.payrollLines} lönerader</li>`
        : ""
    }</ul></div>`;

  const refresh = () => renderReport(id);
  main.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => entryDialog(id, b.dataset.add, null, refresh)));
  main.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const entry = report.entries.find((e) => e.id === b.dataset.edit);
        entryDialog(id, entry.kind, entry, refresh);
      }),
  );
  main.querySelectorAll("[data-remove]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Ta bort posten?")) return;
        await api("DELETE", `/api/reports/${id}/entries/${b.dataset.remove}`);
        refresh();
      }),
  );
  main.querySelectorAll("[data-attachment]").forEach(
    (a) =>
      (a.onclick = async (e) => {
        e.preventDefault();
        const res = await fetch(`/api/attachments/${a.dataset.attachment}`, { headers: { "X-User-Id": state.userId } });
        if (!res.ok) return toast("Kunde inte visa bilden");
        window.open(URL.createObjectURL(await res.blob()), "_blank");
      }),
  );
  const on = (sel, fn) => {
    const el = $(sel);
    if (el)
      el.onclick = async () => {
        try {
          await fn();
        } catch (e) {
          toast(e.message);
        }
      };
  };
  on("#submit", async () => {
    await api("POST", `/api/reports/${id}/submit`);
    toast("Rapporten är inskickad för attest");
    reload();
  });
  on("#approve", async () => {
    const res = await api("POST", `/api/reports/${id}/approve`);
    toast(res.report.status === "approved" ? "Rapporten är attesterad" : "Din attest är registrerad – fler attester krävs");
    reload();
  });
  on("#reject", () =>
    openDialog(
      `<h2>Neka rapport</h2><label>Kommentar till ${esc(view.owner.name)}<textarea name="comment" rows="3" required></textarea></label>${actions("Neka")}`,
      async (fd) => {
        await api("POST", `/api/reports/${id}/reject`, { comment: fd.get("comment") });
        reload();
      },
    ),
  );
  on("#export", async () => {
    const res = await api("POST", `/api/reports/${id}/export`);
    toast(res.sentToFortnox ? `Bokförd i Fortnox: ${res.vouchers.map((v) => v.series + v.number).join(", ")}` : "Markerad som överförd – importera SIE-fil och lönefil i Fortnox");
    reload();
  });
  on("#sie", () => download(`/api/reports/${id}/sie`));
  on("#payroll", () => download(`/api/reports/${id}/payroll.csv`));
  on("#rename", () =>
    openDialog(`<h2>Byt namn</h2><label>Namn<input name="title" required value="${esc(report.title)}" /></label>${actions()}`, async (fd) => {
      await api("PATCH", `/api/reports/${id}`, { title: fd.get("title") });
      refresh();
    }),
  );
  on("#delete", async () => {
    if (!confirm("Ta bort hela rapporten?")) return;
    await api("DELETE", `/api/reports/${id}`);
    location.hash = "#rapporter";
  });
}

function historyLabel(action) {
  return { created: "skapade rapporten", submitted: "skickade in", approved: "attesterade", rejected: "nekade", exported: "överförde till Fortnox", reopened: "öppnade igen" }[action] ?? action;
}

function voucherPreview(view) {
  if (!view.vouchers.length || state.boot.me.role === "employee") return "";
  const names = state.boot.accountNames;
  return `<h2>Bokföring (förhandsvisning)</h2>${view.vouchers
    .map(
      (v) => `<div class="table-wrap" style="margin-bottom:.75rem"><table>
      <thead><tr><th colspan="2">Ver. ${esc(v.series)} · ${esc(v.transactionDate)} · ${esc(v.description)}</th><th class="num">Debet</th><th class="num">Kredit</th></tr></thead>
      <tbody>${v.rows
        .map(
          (r) =>
            `<tr><td>${esc(r.account)}</td><td>${esc(names[r.account] ?? "")}${r.project ? ` <span class="muted">· projekt ${esc(r.project)}</span>` : ""}${
              r.costCenter ? ` <span class="muted">· KS ${esc(r.costCenter)}</span>` : ""
            }</td><td class="num">${r.debit ? sek(r.debit) : ""}</td><td class="num">${r.credit ? sek(r.credit) : ""}</td></tr>`,
        )
        .join("")}</tbody></table></div>`,
    )
    .join("")}`;
}

function payrollPreview(view) {
  if (!view.payroll.length || state.boot.me.role === "employee") return "";
  return `<h2>Till lön (förhandsvisning)</h2><div class="table-wrap"><table>
    <thead><tr><th>Löneart</th><th>Text</th><th class="num">Antal</th><th class="num">À-pris</th><th class="num">Belopp</th></tr></thead>
    <tbody>${view.payroll
      .map((l) => `<tr><td>${esc(l.salaryCode)}</td><td>${esc(l.text)}</td><td class="num">${esc(String(l.quantity).replace(".", ","))}</td><td class="num">${sek(l.rate)}</td><td class="num">${sek(l.amount)}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

// ---------- entry dialogs ----------

function entryDialog(reportId, kind, entry, done) {
  const save = async (body) => {
    if (entry) await api("PUT", `/api/reports/${reportId}/entries/${entry.id}`, body);
    else await api("POST", `/api/reports/${reportId}/entries`, body);
    done();
  };
  if (kind === "receipt") receiptDialog(entry, save);
  else if (kind === "mileage") mileageDialog(entry, save);
  else tripDialog(entry, save);
}

const dims = (e) => `
  <label>Projekt<input name="project" value="${esc(e?.project ?? "")}" /></label>
  <label>Kostnadsställe<input name="costCenter" value="${esc(e?.costCenter ?? "")}" /></label>`;

function receiptDialog(entry, save) {
  const e = entry ?? { date: today(), currency: "SEK", exchangeRate: 1, payment: "private", attachmentIds: [], categoryId: "other", vatRate: 25 };
  let attachmentIds = [...e.attachmentIds];
  const cats = state.boot.settings.categories;
  openDialog(
    `<h2>${entry ? "Ändra kvitto" : "Nytt kvitto"}</h2>
    <fieldset>
      <legend>Kvittobild och tolkning</legend>
      <div class="row">
        <label>Bild eller PDF<input type="file" name="file" accept="image/*,application/pdf" capture="environment" /></label>
        <img class="preview-img" id="preview" alt="" hidden />
        <span class="muted" id="attach-status">${attachmentIds.length ? "Bild bifogad" : "Ingen bild bifogad"}</span>
      </div>
      <div class="row" style="margin-top:.5rem">
        <button type="button" id="ocr" disabled>Läs av bilden (OCR)</button>
        <span class="muted">eller klistra in kvittotext:</span>
      </div>
      <textarea id="receipt-text" rows="3" placeholder="Klistra in text från ett digitalt kvitto…" style="width:100%;margin-top:.5rem"></textarea>
      <button type="button" id="parse" style="margin-top:.5rem">Tolka text</button>
    </fieldset>
    <div class="form-grid">
      <label>Datum<input type="date" name="date" required value="${esc(e.date)}" /></label>
      <label>Säljare<input name="merchant" required value="${esc(e.merchant ?? "")}" /></label>
      <label>Kategori<select name="categoryId">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === e.categoryId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label>Belopp inkl. moms<input name="amount" required inputmode="decimal" value="${oreToInput(e.amount)}" /></label>
      <label>Valuta<input name="currency" maxlength="3" value="${esc(e.currency)}" /></label>
      <label>Växelkurs (SEK)<input name="exchangeRate" inputmode="decimal" value="${esc(String(e.exchangeRate).replace(".", ","))}" /></label>
      <label>Momssats<select name="vatRate">${[25, 12, 6, 0].map((r) => `<option value="${r}" ${r === e.vatRate ? "selected" : ""}>${r} %</option>`).join("")}</select></label>
      <label>Moms (om flera satser)<input name="vatOverride" inputmode="decimal" value="${oreToInput(e.vatOverride)}" placeholder="beräknas" /></label>
      <label>Betalning<select name="payment"><option value="private" ${e.payment === "private" ? "selected" : ""}>Privat (utlägg)</option><option value="company_card" ${
        e.payment === "company_card" ? "selected" : ""
      }>Företagskort</option></select></label>
      ${dims(e)}
      <label class="wide">Beskrivning<input name="description" value="${esc(e.description ?? "")}" /></label>
    </div>
    <fieldset id="rep" hidden>
      <legend>Representation</legend>
      <div class="form-grid">
        <label>Typ<select name="repKind">${Object.entries(REP_KINDS).map(([k, v]) => `<option value="${k}" ${e.representation?.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Syfte<input name="repPurpose" value="${esc(e.representation?.purpose ?? "")}" /></label>
        <label class="wide">Deltagare inklusive dig själv, en per rad (namn och företag)<textarea name="repAttendees" rows="3">${esc((e.representation?.attendees ?? []).join("\n"))}</textarea></label>
      </div>
    </fieldset>
    ${actions()}`,
    async (fd) => {
      const amount = toOre(fd.get("amount"));
      if (!amount || Number.isNaN(amount)) throw new Error("Ange ett belopp");
      const vatOverride = toOre(fd.get("vatOverride"));
      if (Number.isNaN(vatOverride)) throw new Error("Ogiltig moms");
      const cat = category(fd.get("categoryId"));
      await save({
        kind: "receipt",
        date: fd.get("date"),
        merchant: fd.get("merchant"),
        description: fd.get("description"),
        categoryId: fd.get("categoryId"),
        amount,
        currency: String(fd.get("currency") || "SEK").toUpperCase(),
        exchangeRate: Number(String(fd.get("exchangeRate")).replace(",", ".")),
        vatRate: Number(fd.get("vatRate")),
        ...(vatOverride !== undefined ? { vatOverride } : {}),
        payment: fd.get("payment"),
        project: fd.get("project"),
        costCenter: fd.get("costCenter"),
        attachmentIds,
        ...(cat?.representation
          ? {
              representation: {
                kind: fd.get("repKind"),
                purpose: fd.get("repPurpose"),
                attendees: String(fd.get("repAttendees")).split("\n").map((s) => s.trim()).filter(Boolean),
              },
            }
          : {}),
      });
    },
  );

  const form = dialogForm;
  const toggleRep = () => ($("#rep", form).hidden = !category(form.categoryId.value)?.representation);
  form.categoryId.onchange = () => {
    form.vatRate.value = String(category(form.categoryId.value)?.vatRate ?? 25);
    toggleRep();
  };
  toggleRep();

  const fill = (p) => {
    if (p.merchant) form.merchant.value = p.merchant;
    if (p.date) form.date.value = p.date;
    if (p.total !== undefined) form.amount.value = oreToInput(p.total);
    if (p.currency) form.currency.value = p.currency;
    if (p.categoryId) form.categoryId.value = p.categoryId;
    if (p.vatRate !== undefined) form.vatRate.value = String(p.vatRate);
    form.vatOverride.value = p.vatLines.length > 1 ? oreToInput(p.vatTotal) : "";
    toggleRep();
    toast(`Tolkat: ${p.found.length ? p.found.join(", ") : "inget"} – kontrollera uppgifterna`);
  };
  $("#parse", form).onclick = async () => fill(await api("POST", "/api/receipts/parse", { text: $("#receipt-text", form).value }));

  let file;
  form.file.onchange = async () => {
    file = form.file.files[0];
    if (!file) return;
    $("#attach-status", form).textContent = "Laddar upp…";
    try {
      const uploaded = await api("POST", `/api/attachments?name=${encodeURIComponent(file.name)}`, undefined, { data: file, type: file.type || "application/octet-stream" });
      attachmentIds = [uploaded.id];
      $("#attach-status", form).textContent = "Bild bifogad";
      if (file.type.startsWith("image/")) {
        const img = $("#preview", form);
        img.src = URL.createObjectURL(file);
        img.hidden = false;
        $("#ocr", form).disabled = false;
      }
    } catch (err) {
      $("#attach-status", form).textContent = err.message;
    }
  };
  $("#ocr", form).onclick = async () => {
    const btn = $("#ocr", form);
    btn.disabled = true;
    btn.textContent = "Läser av…";
    try {
      // OCR runs in the browser; the receipt image never leaves this machine for it.
      const { default: Tesseract } = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js");
      const { data } = await Tesseract.recognize(file, "swe+eng");
      $("#receipt-text", form).value = data.text;
      fill(await api("POST", "/api/receipts/parse", { text: data.text }));
    } catch (err) {
      toast("OCR misslyckades: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Läs av bilden (OCR)";
    }
  };
}

function mileageDialog(entry, save) {
  const e = entry ?? { date: today(), vehicle: "own_car" };
  const rates = state.boot.rates.mileage;
  openDialog(
    `<h2>${entry ? "Ändra milersättning" : "Milersättning"}</h2>
    <p class="muted">Skattefritt ${new Date().getFullYear()}: egen bil ${sek(rates.ownCar)}/mil, förmånsbil ${sek(rates.companyCarFuel)}/mil, förmånsbil el ${sek(rates.companyCarElectric)}/mil.</p>
    <div class="form-grid">
      <label>Datum<input type="date" name="date" required value="${esc(e.date)}" /></label>
      <label>Från<input name="from" required value="${esc(e.from ?? "")}" /></label>
      <label>Till<input name="to" required value="${esc(e.to ?? "")}" /></label>
      <label>Kilometer<input name="km" required inputmode="decimal" value="${esc(e.km ?? "")}" /></label>
      <label>Fordon<select name="vehicle">${Object.entries(VEHICLES).map(([k, v]) => `<option value="${k}" ${k === e.vehicle ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Registreringsnummer<input name="registrationNumber" value="${esc(e.registrationNumber ?? "")}" /></label>
      <label>Företagets ersättning kr/mil<input name="companyRatePerMil" inputmode="decimal" placeholder="skattefri nivå" value="${oreToInput(e.companyRatePerMil)}" /></label>
      ${dims(e)}
      <label class="wide">Syfte<input name="purpose" required value="${esc(e.purpose ?? "")}" /></label>
    </div>
    <p class="notice info" id="mileage-preview">Fyll i sträckan för att se ersättningen.</p>
    ${actions()}`,
    async (fd) => {
      const companyRatePerMil = toOre(fd.get("companyRatePerMil"));
      await save({
        kind: "mileage",
        date: fd.get("date"),
        from: fd.get("from"),
        to: fd.get("to"),
        purpose: fd.get("purpose"),
        km: Number(String(fd.get("km")).replace(",", ".")),
        vehicle: fd.get("vehicle"),
        registrationNumber: fd.get("registrationNumber"),
        ...(companyRatePerMil !== undefined ? { companyRatePerMil } : {}),
        project: fd.get("project"),
        costCenter: fd.get("costCenter"),
      });
    },
  );
  const form = dialogForm;
  let seq = 0;
  const update = async () => {
    const km = Number(String(form.km.value).replace(",", "."));
    if (!(km > 0)) return;
    const rate = toOre(form.companyRatePerMil.value);
    const mine = ++seq;
    try {
      const r = await api("POST", "/api/calc/mileage", { date: form.date.value, km, vehicle: form.vehicle.value, ...(rate ? { companyRatePerMil: rate } : {}) });
      if (mine !== seq) return;
      $("#mileage-preview", form).textContent = `${String(r.mil).replace(".", ",")} mil → ${sek(r.total)}${r.taxable ? ` (varav ${sek(r.taxable)} skattepliktigt)` : " skattefritt"}`;
    } catch (err) {
      $("#mileage-preview", form).textContent = err.message;
    }
  };
  ["km", "vehicle", "companyRatePerMil", "date"].forEach((n) => form[n].addEventListener("input", update));
  update();
}

function tripDays(dep, ret) {
  const days = [];
  if (!dep || !ret || ret.slice(0, 10) < dep.slice(0, 10)) return days;
  for (let d = new Date(dep.slice(0, 10) + "T00:00:00Z"); d.toISOString().slice(0, 10) <= ret.slice(0, 10); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
    if (days.length > 400) break;
  }
  return days;
}

const newTrip = () => ({ departure: `${today()}T08:00`, return: `${today()}T18:00`, country: "SE", freeMeals: {}, dayCountries: {}, nightAllowance: [] });

function tripFields(e, { calculator = false } = {}) {
  const t = e.trip;
  return `
    <p class="muted">Skattefritt traktamente kräver övernattning och att förrättningsorten ligger mer än 50 km från både bostad och tjänsteställe.</p>
    <div class="form-grid">
      ${calculator ? "" : `<label>Ort<input name="destination" required value="${esc(e.destination ?? "")}" /></label>`}
      <label>Land<select name="country">${countryOptions(t.country)}</select></label>
      <label>Avstånd (km)<input name="distanceKm" inputmode="numeric" value="${esc(t.distanceKm ?? "")}" /></label>
      <label>Avresa<input type="datetime-local" name="departure" required value="${esc(t.departure)}" /></label>
      <label>Hemkomst<input type="datetime-local" name="return" required value="${esc(t.return)}" /></label>
      <label>På orten sedan (vid långa uppdrag)<input type="date" name="sameLocationSince" value="${esc(t.sameLocationSince ?? "")}" /></label>
      ${calculator ? "" : `${dims(e)}<label class="wide">Syfte<input name="purpose" required value="${esc(e.purpose ?? "")}" /></label>`}
    </div>
    <fieldset>
      <legend>Dagar – markera måltider du fått betalda och nätter utan betald logi</legend>
      <div class="table-wrap" data-role="days"></div>
    </fieldset>
    <div class="notice info" data-role="preview"></div>`;
}

/** Wires up a trip form (dialog or calculator page) and returns a function that reads the trip input. */
function wireTripForm(form, t, { details = false } = {}) {
  const meals = structuredClone(t.freeMeals ?? {});
  const dayCountries = structuredClone(t.dayCountries ?? {});
  const nights = new Set(t.nightAllowance === "all" ? tripDays(t.departure, t.return).slice(0, -1) : (t.nightAllowance ?? []));
  const daysBox = $('[data-role="days"]', form);
  const box = $('[data-role="preview"]', form);

  function collect() {
    const days = tripDays(form.departure.value, form.return.value);
    const keep = (obj) => Object.fromEntries(Object.entries(obj).filter(([d]) => days.includes(d)));
    return {
      departure: form.departure.value,
      return: form.return.value,
      country: form.country.value,
      ...(form.distanceKm.value ? { distanceKm: Number(form.distanceKm.value) } : {}),
      ...(form.sameLocationSince.value ? { sameLocationSince: form.sameLocationSince.value } : {}),
      freeMeals: keep(meals),
      dayCountries: keep(dayCountries),
      nightAllowance: [...nights].filter((d) => days.slice(0, -1).includes(d)),
    };
  }

  function drawDays() {
    const days = tripDays(form.departure.value, form.return.value);
    daysBox.innerHTML = days.length
      ? `<table><thead><tr><th>Datum</th><th>Land</th><th>Frukost</th><th>Lunch</th><th>Middag</th><th>Natt utan logi</th></tr></thead><tbody>${days
          .map((d, i) => {
            const m = meals[d] ?? {};
            const c = dayCountries[d] ?? form.country.value;
            const box = (meal) => `<input type="checkbox" data-meal="${meal}" data-day="${d}" ${m[meal] ? "checked" : ""} aria-label="${meal} ${d}" />`;
            return `<tr><td>${d}</td><td><select data-country="${d}" aria-label="Land ${d}">${countryOptions(c).replace('<option value="__other">Annat land…</option>', "")}</select></td><td>${box(
              "breakfast",
            )}</td><td>${box("lunch")}</td><td>${box("dinner")}</td><td>${
              i < days.length - 1 ? `<input type="checkbox" data-night="${d}" ${nights.has(d) ? "checked" : ""} aria-label="natt ${d}" />` : ""
            }</td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<p class="muted">Ange avresa och hemkomst.</p>`;
    daysBox.querySelectorAll("[data-meal]").forEach(
      (cb) =>
        (cb.onchange = () => {
          meals[cb.dataset.day] = { ...(meals[cb.dataset.day] ?? {}), [cb.dataset.meal]: cb.checked };
          preview();
        }),
    );
    daysBox.querySelectorAll("[data-night]").forEach(
      (cb) =>
        (cb.onchange = () => {
          cb.checked ? nights.add(cb.dataset.night) : nights.delete(cb.dataset.night);
          preview();
        }),
    );
    daysBox.querySelectorAll("[data-country]").forEach(
      (sel) =>
        (sel.onchange = () => {
          dayCountries[sel.dataset.country] = sel.value;
          preview();
        }),
    );
    preview();
  }

  let seq = 0;
  async function preview() {
    // Ignore responses that arrive after a newer request so the preview never shows stale numbers.
    const mine = ++seq;
    try {
      const r = await api("POST", "/api/calc/traktamente", collect());
      if (mine !== seq) return;
      if (!r.eligible) {
        box.className = "notice warn";
        box.textContent = r.reasons.join(". ");
        return;
      }
      box.className = "notice info";
      const full = r.days.filter((d) => d.kind === "full").length;
      const headline = `${full} hela och ${r.days.length - full} halva dagar${r.nights.length ? `, ${r.nights.length} nätter` : ""} → skattefritt traktamente ${sek(r.total)}`;
      box.innerHTML = details
        ? `<strong>${esc(headline)}</strong><div class="table-wrap" style="margin-top:.5rem"><table><thead><tr><th>Datum</th><th>Land</th><th>Typ</th><th class="num">Max</th><th class="num">Måltidsavdrag</th><th class="num">Belopp</th></tr></thead><tbody>${r.days
            .map(
              (d) =>
                `<tr><td>${d.date}</td><td>${esc(COUNTRIES[d.country] ?? d.country)}</td><td>${d.kind === "full" ? "Hel dag" : "Halv dag"}${d.longTermPercent < 100 ? ` (${d.longTermPercent} %)` : ""}</td><td class="num">${sek(
                  d.maxAmount,
                )}</td><td class="num">${d.mealReduction ? "−" + sek(d.mealReduction) : ""}</td><td class="num">${sek(d.amount)}</td></tr>`,
            )
            .join("")}${r.nights.map((n) => `<tr><td>${n.date}</td><td>${esc(COUNTRIES[n.country] ?? n.country)}</td><td>Nattraktamente</td><td></td><td></td><td class="num">${sek(n.amount)}</td></tr>`).join("")}</tbody></table></div>`
        : esc(headline);
    } catch (err) {
      if (mine !== seq) return;
      box.className = "notice error";
      box.textContent = err.message;
    }
  }

  form.country.onchange = () => {
    if (form.country.value === "__other") {
      const code = (prompt("Landskod (ISO, två bokstäver), t.ex. IT") || "").trim().toUpperCase();
      form.country.innerHTML = countryOptions(/^[A-Z]{2}$/.test(code) ? code : "SE");
    }
    drawDays();
  };
  ["departure", "return"].forEach((n) => form[n].addEventListener("change", drawDays));
  ["distanceKm", "sameLocationSince"].forEach((n) => form[n].addEventListener("input", preview));
  drawDays();
  return collect;
}

function tripDialog(entry, save) {
  const e = entry ?? { trip: newTrip() };
  let collect;
  openDialog(`<h2>${entry ? "Ändra traktamente" : "Traktamente"}</h2>${tripFields(e)}${actions()}`, async (fd) => {
    await save({ kind: "trip", purpose: fd.get("purpose"), destination: fd.get("destination"), project: fd.get("project"), costCenter: fd.get("costCenter"), trip: collect() });
  });
  collect = wireTripForm(dialogForm, e.trip);
}

// ---------- calculator ----------

function renderCalculator() {
  const trip = { ...newTrip(), return: `${today()}T18:00`.replace(today(), new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)) };
  main.innerHTML = `<h1>Traktamentskalkylator</h1><p class="muted">Räkna fram skattefritt traktamente enligt Skatteverkets regler utan att skapa en rapport.</p>
    <form class="card" id="calc" onsubmit="return false">${tripFields({ trip }, { calculator: true })}</form>`;
  wireTripForm($("#calc"), trip, { details: true });
}

// ---------- settings ----------

function renderSettings() {
  const s = state.boot.settings;
  const employees = state.boot.employees;
  const fortnox = state.boot.fortnox;
  main.innerHTML = `
    <h1>Inställningar</h1>
    <h2>Fortnox</h2>
    <div class="card">
      ${
        fortnox.connected
          ? `<p>✅ Ansluten till Fortnox. Attesterade rapporter bokförs direkt och kvittobilder bifogas verifikationerna.</p><button id="sync">Hämta senaste data från Fortnox</button><pre class="code" id="sync-out" hidden></pre>`
          : fortnox.configured
            ? `<p>Inte ansluten.</p><button class="primary" id="connect">Anslut till Fortnox</button>`
            : `<p class="muted">Sätt <code>FORTNOX_CLIENT_ID</code> och <code>FORTNOX_CLIENT_SECRET</code> för att ansluta via Fortnox API. Utan anslutning exporteras SIE-fil och lönefil.</p>`
      }
    </div>

    <h2>Företag och bokföring</h2>
    <form class="card" id="company">
      <div class="form-grid">
        <label>Företagsnamn<input name="companyName" value="${esc(s.companyName)}" /></label>
        <label>Organisationsnummer<input name="organisationNumber" value="${esc(s.organisationNumber)}" /></label>
        <label>Verifikationsserie<input name="voucherSeries" value="${esc(s.voucherSeries)}" /></label>
        <label>Verifikationer<select name="voucherMode"><option value="per_report" ${s.voucherMode === "per_report" ? "selected" : ""}>En per rapport</option><option value="per_entry" ${
          s.voucherMode === "per_entry" ? "selected" : ""
        }>En per utgift</option></select></label>
        <label>Traktamente och milersättning bokförs av<select name="allowancesTo"><option value="payroll" ${s.allowancesTo === "payroll" ? "selected" : ""}>Fortnox Lön</option><option value="bookkeeping" ${
          s.allowancesTo === "bookkeeping" ? "selected" : ""
        }>Utläggsverifikationen</option></select></label>
        ${Object.entries({
          employeeLiability: "Skuld till anställd",
          companyCard: "Företagskort",
          inputVat: "Ingående moms",
          perDiemDomesticTaxFree: "Traktamente Sverige",
          perDiemForeignTaxFree: "Traktamente utland",
          mileageTaxFree: "Bilersättning skattefri",
          mileageTaxable: "Bilersättning skattepliktig",
        })
          .map(([k, label]) => `<label>Konto: ${label}<input name="acc_${k}" value="${esc(s.accounts[k])}" pattern="\\d{4}" /></label>`)
          .join("")}
        ${Object.entries({
          outlay: "Utlägg",
          perDiemDomesticTaxFree: "Traktamente Sverige",
          perDiemForeignTaxFree: "Traktamente utland",
          mileageTaxFree: "Bilersättning skattefri",
          mileageTaxable: "Bilersättning skattepliktig",
        })
          .map(([k, label]) => `<label>Löneart: ${label}<input name="sal_${k}" value="${esc(s.salaryCodes[k])}" /></label>`)
          .join("")}
        <label>Standardattestant<select name="defaultApproverId"><option value="">–</option>${employees
          .filter((e) => e.role !== "employee")
          .map((e) => `<option value="${esc(e.id)}" ${e.id === s.approval.defaultApproverId ? "selected" : ""}>${esc(e.name)}</option>`)
          .join("")}</select></label>
        <label>Antal attester som krävs<input type="number" min="1" max="5" name="requiredApprovals" value="${s.approval.requiredApprovals}" /></label>
      </div>
      <div class="row" style="margin-top:.75rem"><button class="primary">Spara</button></div>
    </form>

    <h2>Kategorier</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Kategori</th><th>Konto</th><th>Konto utland</th><th>Moms</th></tr></thead>
      <tbody>${s.categories
        .map(
          (c, i) => `<tr><td>${esc(c.name)}${c.representation ? ` <span class="muted">(${esc(c.representation.deductibleAccount)}/${esc(c.representation.nonDeductibleAccount)})</span>` : ""}</td>
          <td><input data-cat="${i}" data-field="account" value="${esc(c.account)}" size="5" aria-label="Konto ${esc(c.name)}" /></td>
          <td><input data-cat="${i}" data-field="foreignAccount" value="${esc(c.foreignAccount ?? "")}" size="5" aria-label="Konto utland ${esc(c.name)}" /></td>
          <td><select data-cat="${i}" data-field="vatRate" aria-label="Moms ${esc(c.name)}">${[25, 12, 6, 0].map((r) => `<option ${r === c.vatRate ? "selected" : ""}>${r}</option>`).join("")}</select></td></tr>`,
        )
        .join("")}</tbody></table></div>
    <div class="row" style="margin-top:.5rem"><button id="save-cats" class="primary">Spara kategorier</button></div>

    <h2>Min organisation</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Namn</th><th>Anst.nr</th><th>Roll</th><th>Avdelning</th><th>Attestant</th><th class="num">Attestgräns</th><th></th></tr></thead>
      <tbody>${employees
        .map(
          (e) => `<tr><td>${esc(e.name)}</td><td>${esc(e.employeeNumber)}</td><td>${esc(e.role)}</td><td>${esc(state.boot.departments.find((d) => d.id === e.departmentId)?.name ?? "–")}</td>
          <td>${e.approverId ? esc(employeeName(e.approverId)) : "–"}</td><td class="num">${e.approvalLimit !== undefined ? sek(e.approvalLimit) : "–"}</td>
          <td><button class="link" data-employee="${esc(e.id)}">Ändra</button></td></tr>`,
        )
        .join("")}</tbody></table></div>
    <div class="row" style="margin-top:.5rem"><button id="add-employee">+ Ny användare</button><button id="add-department">+ Ny avdelning</button></div>
    <p class="muted">Avdelningar: ${state.boot.departments.map((d) => `${esc(d.name)} (attestanter: ${d.approverIds.map(employeeName).map(esc).join(", ") || "–"})`).join("; ") || "–"}</p>`;

  $("#company").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const accounts = Object.fromEntries(Object.keys(s.accounts).map((k) => [k, fd.get(`acc_${k}`)]));
    const salaryCodes = Object.fromEntries(Object.keys(s.salaryCodes).map((k) => [k, fd.get(`sal_${k}`)]));
    try {
      await api("PUT", "/api/settings", {
        companyName: fd.get("companyName"),
        organisationNumber: fd.get("organisationNumber"),
        voucherSeries: fd.get("voucherSeries"),
        voucherMode: fd.get("voucherMode"),
        allowancesTo: fd.get("allowancesTo"),
        accounts,
        salaryCodes,
        approval: { requiredApprovals: Number(fd.get("requiredApprovals")) || 1, ...(fd.get("defaultApproverId") ? { defaultApproverId: fd.get("defaultApproverId") } : {}) },
      });
      toast("Inställningarna är sparade");
      reload();
    } catch (e) {
      toast(e.message);
    }
  };
  $("#save-cats").onclick = async () => {
    const categories = structuredClone(s.categories);
    main.querySelectorAll("[data-cat]").forEach((el) => {
      const c = categories[Number(el.dataset.cat)];
      if (el.dataset.field === "vatRate") c.vatRate = Number(el.value);
      else if (el.dataset.field === "foreignAccount") el.value ? (c.foreignAccount = el.value) : delete c.foreignAccount;
      else c.account = el.value;
    });
    await api("PUT", "/api/settings", { categories });
    toast("Kategorierna är sparade");
    reload();
  };
  const connect = $("#connect");
  if (connect) connect.onclick = async () => (location.href = (await api("GET", "/api/fortnox/connect")).url);
  const sync = $("#sync");
  if (sync)
    sync.onclick = async () => {
      try {
        const data = await api("POST", "/api/fortnox/sync");
        const out = $("#sync-out");
        out.hidden = false;
        out.textContent = `Konton: ${data.accounts.length}\nKostnadsställen: ${data.costCenters.join(", ") || "–"}\nProjekt: ${data.projects.join(", ") || "–"}\nVerifikationsserier: ${data.voucherSeries.join(", ")}`;
      } catch (e) {
        toast(e.message);
      }
    };
  main.querySelectorAll("[data-employee]").forEach((b) => (b.onclick = () => employeeDialog(employees.find((e) => e.id === b.dataset.employee))));
  $("#add-employee").onclick = () => employeeDialog(null);
  $("#add-department").onclick = () =>
    openDialog(
      `<h2>Ny avdelning</h2><label>Namn<input name="name" required /></label>
      <label>Attestanter<select name="approverIds" multiple size="4">${employees.filter((e) => e.role !== "employee").map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></label>${actions()}`,
      async (fd) => {
        await api("POST", "/api/departments", { name: fd.get("name"), approverIds: fd.getAll("approverIds") });
        reload();
      },
    );
}

function employeeDialog(e) {
  const others = state.boot.employees.filter((x) => x.id !== e?.id && x.role !== "employee");
  openDialog(
    `<h2>${e ? "Ändra användare" : "Ny användare"}</h2>
    <div class="form-grid">
      <label>Namn<input name="name" required value="${esc(e?.name ?? "")}" /></label>
      <label>Anställningsnummer (Fortnox Lön)<input name="employeeNumber" required value="${esc(e?.employeeNumber ?? "")}" /></label>
      <label>E-post<input type="email" name="email" value="${esc(e?.email ?? "")}" /></label>
      <label>Roll<select name="role">${["employee", "approver", "admin"].map((r) => `<option ${r === e?.role ? "selected" : ""}>${r}</option>`).join("")}</select></label>
      <label>Avdelning<select name="departmentId"><option value="">–</option>${state.boot.departments.map((d) => `<option value="${esc(d.id)}" ${d.id === e?.departmentId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label>Egen attestant<select name="approverId"><option value="">Enligt avdelning</option>${others.map((o) => `<option value="${esc(o.id)}" ${o.id === e?.approverId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
      <label>Attestgräns (kr)<input name="approvalLimit" inputmode="decimal" placeholder="obegränsad" value="${oreToInput(e?.approvalLimit)}" /></label>
    </div>${actions()}`,
    async (fd) => {
      const limit = toOre(fd.get("approvalLimit"));
      const body = {
        name: fd.get("name"),
        employeeNumber: fd.get("employeeNumber"),
        email: fd.get("email"),
        role: fd.get("role"),
        departmentId: fd.get("departmentId"),
        approverId: fd.get("approverId"),
        ...(limit !== undefined && !Number.isNaN(limit) ? { approvalLimit: limit } : {}),
      };
      if (e) await api("PUT", `/api/employees/${e.id}`, body);
      else await api("POST", "/api/employees", body);
      reload();
    },
  );
}

boot().catch((e) => (main.innerHTML = `<p class="notice error">${esc(e.message)}</p>`));
