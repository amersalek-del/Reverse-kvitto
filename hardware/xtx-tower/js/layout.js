// Pure layout and budget maths for the XTX Tower. No DOM, no three.js.
//
// Coordinates are millimetres. X runs left to right with the spine at x = 0,
// Y is up with the floor at y = 0, and Z runs from the rear wall (z = 0) to
// the glass at the front (z = D).

import { GPUS, BOARDS, LAYOUTS, SLOT_SETS, MAINS, RISER_LENGTHS, FAN_FLOW } from './specs.js';

export const C = Object.freeze({
  wall: 2,
  glass: 4,
  feet: 20,
  fanT: 25,
  slotPitch: 20.32,
  fingerStart: 42,    // card edge fingers start ~42 mm from the bracket
  fingerLen: 89,      // x16 connector length
  riserSocketH: 14,
  plenumH: 32,        // mesh intake band under the GPU chamber (stacked)
  cableTop: 45,       // room above the cards for 8-pin plugs and bends
  tailGap: 40,        // card tail to right wall (side fans live here)
  rearGap: 18,        // rear card backplate to rear wall, minimum
  riserBay: 150,      // floor strip by the spine kept clear for riser sockets
  trayH: 8,
  standoff: 6,
  pcb: 1.6,
  pumpH: 60,
  radT: 27,
  psu: Object.freeze({ w: 150, h: 86 }),
  psuStrip: 22,       // compact: room beside the PSU for its fan and cables
  airRhoCp: 1206,     // J/(m3 K) for air at ~20 C
  fanEfficiency: 0.5, // share of free-air flow left after mesh and fins
});

export const DEFAULTS = Object.freeze({
  layout: 'compact',
  gpu: 'magair',
  gpuCount: 3,
  gpuLimit: 100,
  gpuL: 300, gpuH: 130, gpuT: 60, gpuWatts: 375, gpuPins: 3,
  cardGap: 30,
  glassGap: 30,
  board: 'atx',
  cooler: 'tower',
  coolerH: 160,
  cpuWatts: 250,
  psuMode: 'single',
  psuWatts: 1600,
  psuPcie: 9,
  psuL: 200,
  mains: '230-10',
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, step = 1) => Math.round(v / step) * step;

export function resolveCard(cfg) {
  const preset = GPUS[cfg.gpu] ?? GPUS.magair;
  if (cfg.gpu !== 'custom') return { key: cfg.gpu in GPUS ? cfg.gpu : 'magair', ...preset };
  return {
    ...preset,
    key: 'custom',
    l: clamp(num(cfg.gpuL, preset.l), 150, 420),
    h: clamp(num(cfg.gpuH, preset.h), 90, 180),
    t: clamp(num(cfg.gpuT, preset.t), 18, 90),
    watts: clamp(num(cfg.gpuWatts, preset.watts), 50, 700),
    pins: clamp(Math.round(num(cfg.gpuPins, preset.pins)), 0, 4),
  };
}

export function normalizeConfig(input = {}) {
  const cfg = { ...DEFAULTS, ...input };
  if (!(cfg.layout in LAYOUTS)) cfg.layout = 'compact';
  if (!(cfg.gpu in GPUS)) cfg.gpu = 'magair';
  cfg.gpuLimit = clamp(Math.round(num(cfg.gpuLimit, 100)), 50, 100);
  cfg.gpuCount = clamp(Math.round(num(cfg.gpuCount, 3)), 1, 4);
  cfg.cardGap = clamp(num(cfg.cardGap, 30), 5, 80);
  cfg.glassGap = clamp(num(cfg.glassGap, 30), 5, 80);
  if (!(cfg.board in BOARDS)) cfg.board = 'atx';
  if (cfg.cooler !== 'aio') cfg.cooler = 'tower';
  cfg.coolerH = clamp(num(cfg.coolerH, 160), 100, 180);
  cfg.cpuWatts = clamp(num(cfg.cpuWatts, 250), 35, 600);
  // The compact base only has room for one supply, on its side.
  if (cfg.psuMode !== 'dual' || cfg.layout === 'compact') cfg.psuMode = 'single';
  cfg.psuWatts = clamp(num(cfg.psuWatts, 1600), 450, 2800);
  cfg.psuPcie = clamp(Math.round(num(cfg.psuPcie, 9)), 0, 16);
  cfg.psuL = clamp(num(cfg.psuL, 200), 140, 230);
  if (!(cfg.mains in MAINS)) cfg.mains = '230-10';
  return cfg;
}

// Lay out a grid of square fans inside a rectangle, choosing the size
// (140 or 120 mm) that covers the most area.
export function fanGrid(a0, a1, b0, b1) {
  let best = { size: 140, cols: 0, rows: 0, area: 0 };
  for (const size of [140, 120]) {
    const pitch = size + 6;
    const cols = Math.max(0, Math.floor((a1 - a0) / pitch));
    const rows = Math.max(0, Math.floor((b1 - b0) / pitch));
    const area = cols * rows * size * size;
    if (area > best.area) best = { size, cols, rows, area };
  }
  const pitch = best.size + 6;
  const ca = (a0 + a1) / 2 - ((best.cols - 1) * pitch) / 2;
  const cb = (b0 + b1) / 2 - ((best.rows - 1) * pitch) / 2;
  const fans = [];
  for (let i = 0; i < best.cols; i++) {
    for (let j = 0; j < best.rows; j++) fans.push({ a: ca + i * pitch, b: cb + j * pitch });
  }
  return { size: best.size, fans };
}

export function riserLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

export function computeLayout(input) {
  const cfg = normalizeConfig(input);
  const card = resolveCard(cfg);
  const board = BOARDS[cfg.board];
  const mains = MAINS[cfg.mains];
  const mode = LAYOUTS[cfg.layout];
  const compact = cfg.layout === 'compact';
  const n = cfg.gpuCount;
  const { wall } = C;
  const spine = mode.spine;
  const plenumH = compact ? 0 : C.plenumH;
  const floorLayer = compact ? 0 : C.fanT;
  const cardWatts = Math.round((card.watts * cfg.gpuLimit) / 100);

  // ---- Footprint -------------------------------------------------------
  // Stacked: front intake fans (or an AIO radiator) inside the drawer front.
  // Compact: the tower cooler breathes through the front mesh directly.
  const radFront = C.radT + C.fanT + 8;
  const drawerFront = cfg.cooler === 'aio' ? radFront : compact ? 0 : C.fanT + 8;
  const boardMargin = compact ? 6 : 12;
  const depthDrawer = 2 * wall + 2 * boardMargin + board.l + drawerFront;
  const stack = n * card.t + (n - 1) * cfg.cardGap;
  const depthGpu = wall + C.rearGap + stack + cfg.glassGap + C.glass;
  const depthPsu = compact
    ? 2 * wall + cfg.psuL + 12
    : 2 * wall + (cfg.psuMode === 'dual' ? 2 * C.psu.w + 36 : C.psu.w + 24);
  const D = Math.ceil(Math.max(depthDrawer, depthGpu, depthPsu));

  const psuStripW = C.psu.h + C.psuStrip;
  const W = Math.ceil(Math.max(
    spine + card.l + C.tailGap + wall,
    compact
      ? spine + 4 + board.w + 10 + psuStripW + wall
      : spine + 4 + board.w + 74 + wall,
    compact ? 0 : spine + cfg.psuL + 70 + wall,
    compact ? 0 : spine + C.riserBay + 130 + wall,
  ));

  // ---- Power module (stacked only) ---------------------------------------
  const hPower = compact ? 0 : 2 * wall + 8 + C.psu.h + 14;
  const powerY0 = C.feet;
  const drawerY0 = powerY0 + hPower;

  // ---- Board drawer -----------------------------------------------------
  const compH = cfg.cooler === 'aio' ? C.pumpH : cfg.coolerH;
  const innerComp = C.trayH + C.standoff + C.pcb + compH + 14;
  const frontFanSize = cfg.cooler === 'aio' || innerComp < 146 ? 120 : 140;
  const innerFront = drawerFront > 0 ? frontFanSize + 8 : 0;
  const innerPsu = compact ? C.psu.w + 12 : 0;
  const hDrawer = Math.ceil(2 * wall + Math.max(innerComp, innerFront, innerPsu));
  const boardX0 = spine + 4;
  const boardZ0 = wall + boardMargin;
  const boardTop = drawerY0 + wall + C.trayH + C.standoff + C.pcb;

  // Supplies. `s*` are the box sizes along X/Y/Z; `inlet` is the face with
  // the mains socket and `fan` the face the PSU fan breathes through.
  const psus = [];
  if (compact) {
    psus.push({ x0: W - wall - psuStripW + 4, y0: drawerY0 + wall + 6, z0: wall + 6, sx: C.psu.h, sy: C.psu.w, sz: cfg.psuL, inlet: '-z', fan: '+x' });
  } else {
    const count = cfg.psuMode === 'dual' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const zc = count === 1 ? D / 2 : D / 2 + (i === 0 ? 1 : -1) * (C.psu.w / 2 + 6);
      psus.push({ x0: spine, y0: powerY0 + wall + 8, z0: zc - C.psu.w / 2, sx: cfg.psuL, sy: C.psu.h, sz: C.psu.w, inlet: '-x', fan: '-y' });
    }
  }

  const fanSpanX0 = spine + wall;
  const fanSpanX1 = compact ? W - wall - psuStripW : W - wall;
  const usableX = fanSpanX1 - fanSpanX0;
  let drawerFans = [];
  let radiator = null;
  if (cfg.cooler === 'aio') {
    const radFans = clamp(Math.floor((usableX - 40) / 120), 2, 3);
    const len = radFans * 120 + 37;
    const x0 = fanSpanX0 + (usableX - len) / 2;
    radiator = { x0, len, fans: radFans, z1: D - wall - 2 };
    drawerFans = Array.from({ length: radFans }, (_, i) => ({ x: x0 + 18.5 + 60 + i * 120, size: 120 }));
  } else if (!compact) {
    const count = clamp(Math.floor((usableX - 10) / (frontFanSize + 6)), 1, 3);
    const pitch = frontFanSize + 6;
    const cx = fanSpanX0 + usableX / 2;
    drawerFans = Array.from({ length: count }, (_, i) => ({ x: cx + (i - (count - 1) / 2) * pitch, size: frontFanSize }));
  }

  const slotV = (k) => board.l - 22 - (7 - k) * C.slotPitch;
  const slotNumbers = SLOT_SETS[n - 1];

  // ---- GPU module (top) -------------------------------------------------
  const gpuY0 = drawerY0 + hDrawer;
  const chamberY0 = gpuY0 + plenumH + floorLayer + wall;
  const cardY0 = chamberY0 + C.riserSocketH;
  const cardTop = cardY0 + card.h;
  const hGpu = Math.ceil(cardTop + C.cableTop + C.fanT + wall - gpuY0);
  const H = gpuY0 + hGpu;

  const cards = [];
  for (let i = 0; i < n; i++) {
    const zFront = D - C.glass - cfg.glassGap - i * (card.t + cfg.cardGap);
    cards.push({ index: i, x0: spine, y0: cardY0, z0: zFront - card.t, l: card.l, h: card.h, t: card.t, zPcb: zFront - card.t + 8 });
  }

  // Front card pairs with the front-most slot so the risers never cross.
  // Stacked: the riser bends in the plenum under the GPU chamber.
  // Compact: it rises to just under the drawer lid, runs over the CPU
  // cooler to sit under its card, then goes up through the lid.
  const slotsFrontFirst = [...slotNumbers].sort((a, b) => b - a);
  const fingerX = spine + C.fingerStart + C.fingerLen / 2;
  const lidUnderside = gpuY0 - wall;
  const risers = cards.map((c, i) => {
    const slot = slotsFrontFirst[i];
    const from = { x: boardX0 + C.fingerStart + C.fingerLen / 2, y: boardTop + 11, z: boardZ0 + slotV(slot) };
    const to = { x: fingerX, y: chamberY0, z: c.zPcb };
    const points = compact
      ? [from, { x: from.x, y: lidUnderside - 6, z: from.z }, { x: to.x, y: lidUnderside - 6, z: to.z }, to]
      : [from, { x: from.x, y: gpuY0 - 6, z: from.z }, { x: to.x, y: to.y - 22, z: to.z }, to];
    const through = compact ? { x: to.x, z: to.z } : { x: from.x, z: from.z };
    const length = Math.ceil(riserLength(points) + 20);
    const buy = RISER_LENGTHS.find((l) => l >= length) ?? null;
    return { card: i, slot, lanes: laneFor(board, n, slot, slotNumbers), points, through, length, buy };
  });

  const noFans = { size: 140, fans: [] };
  const floorFans = compact ? noFans : fanGrid(spine + C.riserBay, W - wall, wall, D - C.glass);
  const roofFans = fanGrid(spine + wall, W - wall, wall, D - C.glass);
  const sideFans = fanGrid(wall, D - C.glass, chamberY0, cardTop + C.cableTop - 4);

  // ---- Budgets ----------------------------------------------------------
  const rearFan = !compact;
  const fanCount = floorFans.fans.length + roofFans.fans.length + sideFans.fans.length
    + drawerFans.length + (rearFan ? 1 : 0) + (cfg.cooler === 'tower' ? 1 : 0);
  const baseWatts = 60 + fanCount * 3;
  const gpuWatts = n * cardWatts;
  const dcWatts = gpuWatts + cfg.cpuWatts + baseWatts;
  // Capacity that keeps the sustained load at or under 80 %.
  const recommendedWatts = Math.ceil(dcWatts / 0.8 / 50) * 50;

  const supplies = [];
  if (cfg.psuMode === 'single') {
    supplies.push({ name: 'PSU', rating: cfg.psuWatts, load: dcWatts, cards: cards.map((c) => c.index), feedsBoard: true });
  } else {
    supplies.push({ name: 'PSU A', rating: cfg.psuWatts, load: cfg.cpuWatts + baseWatts, cards: [], feedsBoard: true });
    supplies.push({ name: 'PSU B', rating: cfg.psuWatts, load: 0, cards: [], feedsBoard: false });
    // Each card takes all its 8-pin plugs from one supply; fill the lighter one.
    for (const c of cards) {
      const target = supplies[1].load < supplies[0].load ? supplies[1] : supplies[0];
      target.load += cardWatts;
      target.cards.push(c.index);
    }
  }
  for (const s of supplies) {
    s.pct = s.load / s.rating;
    s.pinsNeeded = s.cards.length * card.pins;
    s.status = s.pct <= 0.8 ? 'ok' : s.pct <= 0.9 ? 'caution' : 'bad';
    // Per-card cap that would bring this supply down to 80 %.
    const other = s.load - s.cards.length * cardWatts;
    s.capForOk = s.cards.length ? Math.floor((0.8 * s.rating - other) / s.cards.length / 5) * 5 : null;
  }

  const efficiency = mains.volts >= 200 ? 0.92 : 0.9;
  const wallWatts = dcWatts / efficiency;
  const wallAmps = wallWatts / mains.volts;
  const circuitPct = wallAmps / mains.amps;
  const circuit = {
    ...mains,
    wallWatts: round(wallWatts, 10),
    amps: Math.round(wallAmps * 10) / 10,
    pct: circuitPct,
    status: circuitPct <= 0.6 ? 'ok' : circuitPct <= 0.8 ? 'caution' : 'bad',
  };

  const intakeFree = (floorFans.fans.length * FAN_FLOW[floorFans.size]) + (sideFans.fans.length * FAN_FLOW[sideFans.size]);
  const exhaustFree = roofFans.fans.length * FAN_FLOW[roofFans.size];
  const flowM3h = C.fanEfficiency * (intakeFree + exhaustFree) / 2;
  const deltaT = flowM3h > 0 ? gpuWatts / (C.airRhoCp * (flowM3h / 3600)) : Infinity;
  const neededM3h = (gpuWatts / (C.airRhoCp * 10)) * 3600;
  const airflow = {
    heat: gpuWatts,
    intakeFree, exhaustFree,
    flowM3h: Math.round(flowM3h),
    flowCfm: Math.round(flowM3h * 0.5886),
    neededM3h: Math.round(neededM3h),
    neededCfm: Math.round(neededM3h * 0.5886),
    deltaT: Math.round(deltaT * 10) / 10,
    status: deltaT <= 15 ? 'ok' : deltaT <= 20 ? 'caution' : 'bad',
  };

  // ---- Warnings ---------------------------------------------------------
  const warnings = [];
  const warn = (level, text) => warnings.push({ level, text });
  for (const s of supplies) {
    if (s.status !== 'ok') {
      const fixes = [];
      if (s.capForOk && s.capForOk < cardWatts && s.capForOk >= card.watts * 0.5) fixes.push(`cap each card at about ${s.capForOk} W`);
      fixes.push('use a bigger supply');
      if (compact) fixes.push('switch to the stacked layout with two supplies');
      warn(s.status === 'bad' ? 'bad' : 'caution',
        `${s.name} runs at ${Math.round(s.pct * 100)} % of ${s.rating} W. Keep sustained load under about 80 % so the cards' short power spikes have headroom: ${joinOr(fixes)}.`);
    }
    if (s.pinsNeeded > cfg.psuPcie) {
      warn('bad', `${s.name} needs ${s.pinsNeeded} PCIe 8-pin outputs but has ${cfg.psuPcie}. Use one cable per 8-pin plug, not daisy-chained pigtails.`);
    }
  }
  if (circuit.status === 'bad') {
    warn('bad', `At the wall this draws about ${circuit.wallWatts} W (${circuit.amps} A), over 80 % of a ${mains.label} circuit. Use a dedicated circuit or cap the cards' power.`);
  } else if (circuit.status === 'caution') {
    warn('caution', `About ${circuit.wallWatts} W (${circuit.amps} A) at the wall leaves little room on a ${mains.label} circuit for anything else.`);
  }
  if (airflow.status !== 'ok') {
    warn(airflow.status, `GPU exhaust air runs roughly ${airflow.deltaT} °C above room temperature. Faster fans, wider card gaps or a power cap will help.`);
  }
  if (cfg.cardGap < 20) warn('caution', `A ${cfg.cardGap} mm gap starves the fans of the card behind. 25-35 mm works well for open-air coolers.`);
  if (cfg.glassGap < 20) warn('caution', `The front card's fans sit ${cfg.glassGap} mm from the glass. Give them at least 20 mm.`);
  if (cfg.board === 'atx' && n === 4) warn('caution', 'Few consumer boards have four x16-size slots. A fourth card usually needs an M.2-to-PCIe x4 adapter.');
  for (const r of risers) {
    if (r.buy === null || r.length > 400) {
      warn('caution', `GPU ${r.card + 1}'s riser needs about ${r.length} mm. Long PCIe 4.0 risers can drop to errors; buy a shielded Gen4 riser or set the slot to Gen3 in BIOS.`);
    }
  }
  if (!compact && floorFans.fans.length === 0) warn('caution', 'No room for floor intake fans in the GPU module. Make the case wider.');
  if (compact && cfg.cooler === 'tower' && cfg.coolerH > 165) warn('caution', `A ${cfg.coolerH} mm cooler leaves the risers little room under the drawer lid. 160 mm or lower is easier.`);

  return {
    cfg, card, board, n, mode: cfg.layout, compact, spine, cardWatts,
    W, D, H,
    volumeL: Math.round((W * D * H) / 1e5) / 10,
    power: { y0: powerY0, h: hPower, psus },
    drawer: {
      y0: drawerY0, h: hDrawer,
      board: { x0: boardX0, z0: boardZ0, top: boardTop, w: board.w, l: board.l, socket: board.socket, dimms: board.dimms },
      slots: slotNumbers.map((k) => ({ number: k, z: boardZ0 + slotV(k) })),
      allSlots: [1, 2, 3, 4, 5, 6, 7].map((k) => ({ number: k, z: boardZ0 + slotV(k), used: slotNumbers.includes(k) })),
      cooler: cfg.cooler, coolerH: cfg.coolerH,
      fans: drawerFans, radiator, rearFan,
    },
    gpu: {
      y0: gpuY0, h: hGpu, plenumH, chamberY0, cardY0, cardTop,
      cards, floorFans, roofFans, sideFans,
    },
    risers,
    budget: { cardWatts, gpuWatts, cpuWatts: cfg.cpuWatts, baseWatts, dcWatts, recommendedWatts, supplies, circuit, pinsTotal: n * card.pins },
    airflow,
    warnings,
  };
}

function joinOr(items) {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function laneFor(board, n, slot, slotNumbers) {
  const order = [...slotNumbers].sort((a, b) => a - b);
  return board.lanes[n - 1][order.indexOf(slot)] ?? '';
}
