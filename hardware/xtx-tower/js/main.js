// UI wiring for the XTX Tower mockup: form -> layout -> scene + report.

import { computeLayout, normalizeConfig, DEFAULTS } from './layout.js';
import { GPUS, BOARDS, LAYOUTS, PSU_RATINGS, MAINS } from './specs.js';

const STORE_KEY = 'xtx-tower:v3';
const $ = (sel) => document.querySelector(sel);
const form = $('#config');
const viewport = $('#viewport');
const tooltip = $('#tooltip');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => `${Math.round(x * 100)} %`;
const worst = (levels) => (levels.includes('bad') ? 'bad' : levels.includes('caution') ? 'caution' : 'ok');

// ---------------------------------------------------------------- config

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') return normalizeConfig(saved);
  } catch { /* storage unavailable */ }
  return normalizeConfig({});
}

function saveConfig(cfg) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function fillSelect(name, entries) {
  const el = form.elements[name];
  el.innerHTML = entries.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
}

fillSelect('gpu', Object.entries(GPUS).map(([k, g]) => [k, g.name]));
fillSelect('board', Object.entries(BOARDS).map(([k, b]) => [k, b.name]));
fillSelect('psuWatts', PSU_RATINGS.map((w) => [w, `${w} W`]));
fillSelect('mains', Object.entries(MAINS).map(([k, m]) => [k, m.label]));

function writeForm(cfg) {
  for (const [name, value] of Object.entries(cfg)) {
    const el = form.elements[name];
    if (!el) continue;
    if (el instanceof RadioNodeList) {
      for (const r of el) r.checked = String(r.value) === String(value);
    } else {
      el.value = String(value);
    }
  }
  if (!PSU_RATINGS.includes(cfg.psuWatts)) {
    const opt = new Option(`${cfg.psuWatts} W`, String(cfg.psuWatts));
    form.elements.psuWatts.add(opt);
    form.elements.psuWatts.value = String(cfg.psuWatts);
  }
  syncFormDetails(cfg);
}

function readForm() {
  const data = {};
  for (const name of Object.keys(DEFAULTS)) {
    const el = form.elements[name];
    if (!el) continue;
    data[name] = el.value;
  }
  return normalizeConfig(data);
}

function syncFormDetails(cfg) {
  const preset = GPUS[cfg.gpu];
  $('#custom-gpu').hidden = cfg.gpu !== 'custom';
  $('#gpu-spec').textContent = cfg.gpu === 'custom'
    ? 'Enter the size of your card. Board power is used for the PSU and airflow checks.'
    : `${preset.l} × ${preset.h} × ${preset.t} mm, ${preset.slots}-slot. ${preset.note}`;
  $('#cooler-height').hidden = cfg.cooler !== 'tower';
  const stacked = cfg.layout === 'stacked';
  for (const r of form.elements.psuMode) r.disabled = !stacked && r.value === 'dual';
  $('#psu-hint').hidden = stacked;
  $('#reach-field').hidden = cfg.layout !== 'staggered';
  for (const out of form.querySelectorAll('output[data-for]')) {
    const key = out.dataset.for;
    if (key === 'gpuLimit') {
      const base = cfg.gpu === 'custom' ? cfg.gpuWatts : GPUS[cfg.gpu].watts;
      out.textContent = `${cfg.gpuLimit} % · ${Math.round((base * cfg.gpuLimit) / 100)} W`;
    } else {
      out.textContent = `${cfg[key]} mm`;
    }
  }
}

let cfg = loadConfig();
writeForm(cfg);

form.addEventListener('input', (e) => {
  const name = e.target.name;
  const prev = cfg;
  cfg = readForm();
  if (name === 'gpu' && cfg.gpu === 'custom') {
    // Start the custom card from the preset that was selected before.
    const from = GPUS[prev.gpu] ?? GPUS.reference;
    Object.assign(cfg, { gpuL: from.l, gpuH: from.h, gpuT: from.t, gpuWatts: from.watts, gpuPins: from.pins });
    writeForm(cfg);
  }
  if (name === 'layout') writeForm(cfg);
  if (name === 'board') {
    cfg.cpuWatts = BOARDS[cfg.board].cpuWatts;
    form.elements.cpuWatts.value = String(cfg.cpuWatts);
  }
  syncFormDetails(cfg);
  schedule();
});

// Keep what the user typed visible while it is being edited, then tidy it.
form.addEventListener('change', () => writeForm(cfg));

$('#reset').addEventListener('click', () => {
  cfg = normalizeConfig({});
  writeForm(cfg);
  schedule();
});

// ----------------------------------------------------------------- scene

let scene = null;
let pending = false;
let layout = null;

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    update();
  });
}

function update() {
  layout = computeLayout(cfg);
  saveConfig(cfg);
  $('#headline').textContent = `${LAYOUTS[cfg.layout].name} · ${layout.W} × ${layout.D} × ${layout.H} mm · ${layout.bodyL} L · ${layout.n} × RX 7900 XTX`;
  // Compare with the other layouts. Volume is the modules themselves, not
  // the air around the parts that stick out.
  const others = Object.keys(LAYOUTS).filter((k) => k !== cfg.layout).map((k) => {
    const o = computeLayout({ ...cfg, layout: k });
    return `${LAYOUTS[k].name}: ${o.W} × ${o.D} × ${o.H} mm, ${o.bodyL} L`;
  });
  $('#layout-spec').textContent = `${LAYOUTS[cfg.layout].note} Takes ${layout.W} × ${layout.D} mm of desk, ${layout.H} mm tall, ${layout.bodyL} L of case. ${others.join('. ')}.`;
  renderReport(layout);
  if (scene) scene.build(layout);
}

async function startScene() {
  try {
    const { TowerScene } = await import('./scene.js');
    scene = new TowerScene(viewport);
    window.__xtx = scene;
    applyView();
    if (layout) scene.build(layout);
  } catch (err) {
    console.error(err);
    $('#fallback').hidden = false;
    $('.toolbar').hidden = true;
  }
}

// ------------------------------------------------------------- view bar

const view = { explode: false, drawer: false, glass: false, airflow: false, xray: false, dims: true, spin: false };

function applyView() {
  for (const btn of document.querySelectorAll('[data-toggle]')) {
    btn.setAttribute('aria-pressed', String(view[btn.dataset.toggle]));
  }
  if (!scene) return;
  scene.setTargets({ explode: view.explode ? 1 : 0, drawer: view.drawer ? 1 : 0, glass: view.glass ? 1 : 0 });
  scene.setFlags({ airflow: view.airflow, xray: view.xray, dims: view.dims });
  scene.setAutoRotate(view.spin);
}

$('.toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.toggle) {
    const key = btn.dataset.toggle;
    view[key] = !view[key];
    applyView();
    if (key === 'explode' && scene) scene.view('right');
  } else if (btn.dataset.view && scene) {
    view.spin = false;
    applyView();
    scene.view(btn.dataset.view);
  }
});

// --------------------------------------------------------------- tooltip

function showTip(info, x, y) {
  if (!info) {
    tooltip.hidden = true;
    return;
  }
  tooltip.innerHTML = `<strong>${esc(info.title)}</strong><span>${esc(info.detail)}</span>`;
  tooltip.hidden = false;
  const box = viewport.getBoundingClientRect();
  const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
  let left = x - box.left + 16, top = y - box.top + 16;
  if (left + w > box.width - 8) left = x - box.left - w - 16;
  if (top + h > box.height - 60) top = Math.max(8, y - box.top - h - 16);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${top}px`;
}

let down = null;
let hoverFrame = 0;
viewport.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
viewport.addEventListener('pointerup', (e) => {
  if (!scene || !down) return;
  const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  if (tap && e.pointerType !== 'mouse') showTip(scene.pick(e.clientX, e.clientY), e.clientX, e.clientY);
});
viewport.addEventListener('pointermove', (e) => {
  if (!scene || e.pointerType !== 'mouse' || e.buttons) {
    if (e.buttons) tooltip.hidden = true;
    return;
  }
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => showTip(scene.pick(e.clientX, e.clientY), e.clientX, e.clientY));
});
viewport.addEventListener('pointerleave', () => { tooltip.hidden = true; });

// ---------------------------------------------------------------- report

function renderReport(L) {
  const b = L.budget;
  const a = L.airflow;
  const powerLevel = worst(b.supplies.map((s) => (s.pinsNeeded > L.cfg.psuPcie ? 'bad' : s.status)));
  const chips = [
    [powerLevel, powerLevel === 'ok' ? 'PSU headroom OK' : powerLevel === 'caution' ? 'PSU tight' : 'PSU overloaded'],
    [b.circuit.status, b.circuit.status === 'ok' ? 'Wall circuit OK' : b.circuit.status === 'caution' ? 'Wall circuit tight' : 'Wall circuit over'],
    [a.status, a.status === 'ok' ? 'Airflow OK' : a.status === 'caution' ? 'Airflow marginal' : 'Airflow short'],
  ];
  $('#status').innerHTML = chips.map(([lvl, text]) => `<span class="chip ${lvl}">${esc(text)}</span>`).join('');

  const names = (s) => [s.feedsBoard ? 'board + CPU' : null, ...s.cards.map((c) => `GPU ${c + 1}`)].filter(Boolean).join(', ') || 'nothing';
  const supplies = b.supplies.map((s) => {
    const pinsOk = s.pinsNeeded <= L.cfg.psuPcie;
    return `<div class="supply">
      <header><span>${esc(s.name)} · ${fmt(s.rating)} W</span><span class="${s.status}">${pct(s.pct)}</span></header>
      <div class="bar ${s.status}"><i style="width:${Math.min(100, s.pct * 100).toFixed(1)}%"></i></div>
      <p>${fmt(s.load)} W sustained. Feeds ${esc(names(s))}. <span class="${pinsOk ? '' : 'bad'}">${s.pinsNeeded} of ${L.cfg.psuPcie} PCIe 8-pin outputs used.</span></p>
    </div>`;
  }).join('');

  const risers = L.risers.map((r) => `<tr>
      <td>GPU ${r.card + 1}</td><td>Slot ${r.slot}</td><td>${esc(r.lanes)}</td>
      <td class="num">${r.length} mm</td><td class="num">${r.buy ? `${r.buy} mm` : 'custom'}</td>
    </tr>`).join('');

  const fanText = (grid, where) => grid.fans.length ? `${grid.fans.length} × ${grid.size} mm ${where}` : null;
  const intake = [fanText(L.gpu.floorFans, 'floor'), fanText(L.gpu.underFans, 'under the overhang'), fanText(L.gpu.sideFans, 'side')].filter(Boolean).join(' + ') || 'none';
  const exhaust = fanText(L.gpu.roofFans, 'roof') || 'none';

  const warnings = L.warnings.length
    ? L.warnings.map((w) => `<li class="${w.level}">${esc(w.text)}</li>`).join('')
    : '<li class="ok">No problems found with these settings.</li>';

  $('#report').innerHTML = `
    <h2>Checks <small>${L.warnings.length ? `${L.warnings.length} to look at` : 'all clear'}</small></h2>
    <ul class="warnings">${warnings}</ul>

    <h2>Power <small>${fmt(b.recommendedWatts)} W keeps it under 80 %</small></h2>
    <table>
      <tr><td>${L.n} × ${esc(L.card.name)}, ${fmt(b.cardWatts)} W each${L.cfg.gpuLimit < 100 ? ` (${L.cfg.gpuLimit} % limit)` : ''}</td><td class="num">${fmt(b.gpuWatts)} W</td></tr>
      <tr><td>CPU</td><td class="num">${fmt(b.cpuWatts)} W</td></tr>
      <tr><td>Board, RAM, drives, fans</td><td class="num">${fmt(b.baseWatts)} W</td></tr>
      <tr class="total"><td>Sustained DC load</td><td class="num">${fmt(b.dcWatts)} W</td></tr>
    </table>
    ${supplies}
    <table>
      <tr><td>At the wall (${esc(b.circuit.label)})</td><td class="num"><span class="${b.circuit.status}">${fmt(b.circuit.wallWatts)} W · ${b.circuit.amps} A · ${pct(b.circuit.pct)}</span></td></tr>
      <tr><td>Heat into the room</td><td class="num">≈ ${(b.circuit.wallWatts / 1000).toFixed(1)} kW</td></tr>
    </table>

    <h2>Risers <small>shielded PCIe 4.0 x16</small></h2>
    <table>
      <tr><th>Card</th><th>Slot</th><th>Link</th><th class="num">Path</th><th class="num">Buy</th></tr>
      ${risers}
    </table>

    <h2>GPU airflow <small>rough estimate</small></h2>
    <table>
      <tr><td>Heat from the cards</td><td class="num">${fmt(a.heat)} W</td></tr>
      <tr><td>Intake</td><td class="num">${esc(intake)}</td></tr>
      <tr><td>Exhaust</td><td class="num">${esc(exhaust)}</td></tr>
      <tr><td>Estimated flow</td><td class="num">${fmt(a.flowM3h)} m³/h (${fmt(a.flowCfm)} CFM)</td></tr>
      <tr><td>Needed for a 10 °C rise</td><td class="num">${fmt(a.neededM3h)} m³/h (${fmt(a.neededCfm)} CFM)</td></tr>
      <tr class="total"><td>Exhaust above room</td><td class="num"><span class="${a.status}">≈ ${a.deltaT} °C</span></td></tr>
    </table>
  `;
}

update();
startScene();
