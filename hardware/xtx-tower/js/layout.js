// Pure layout and budget maths for the XTX Tower. No DOM, no three.js.
//
// Coordinates are millimetres. X runs left to right with the spine at x = 0,
// Y is up with the floor at y = 0, and Z runs from the rear wall (z = 0) to
// the front. Every module hangs off the spine and is flush at the rear; in
// the staggered layout each one is sized to its contents, so they stick out
// by different amounts to the right and front.

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
  podSide: 12,        // staggered: room each side of the PSU in its pod
  podFront: 32,       // staggered: cable room in front of the PSU
  podTop: 14,         // staggered: gap above the PSU fan under the mesh top
  underGap: 20,       // staggered: clear air under the overhang fans
  airRhoCp: 1206,     // J/(m3 K) for air at ~20 C
  fanEfficiency: 0.5, // share of free-air flow left after mesh and fins
});

export const DEFAULTS = Object.freeze({
  layout: 'staggered',
  reach: 60,
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
  if (!(cfg.layout in LAYOUTS)) cfg.layout = 'staggered';
  cfg.reach = clamp(num(cfg.reach, 60), 0, 120);
  if (!(cfg.gpu in GPUS)) cfg.gpu = 'magair';
  cfg.gpuLimit = clamp(Math.round(num(cfg.gpuLimit, 100)), 50, 100);
  cfg.gpuCount = clamp(Math.round(num(cfg.gpuCount, 3)), 1, 4);
  cfg.cardGap = clamp(num(cfg.cardGap, 30), 5, 80);
  cfg.glassGap = clamp(num(cfg.glassGap, 30), 5, 80);
  if (!(cfg.board in BOARDS)) cfg.board = 'atx';
  if (cfg.cooler !== 'aio') cfg.cooler = 'tower';
  cfg.coolerH = clamp(num(cfg.coolerH, 160), 100, 180);
  cfg.cpuWatts = clamp(num(cfg.cpuWatts, 250), 35, 600);
  // Only the stacked power module has room for two supplies.
  if (cfg.psuMode !== 'dual' || cfg.layout !== 'stacked') cfg.psuMode = 'single';
  cfg.psuWatts = clamp(num(cfg.psuWatts, 1600), 450, 2800);
  cfg.psuPcie = clamp(Math.round(num(cfg.psuPcie, 9)), 0, 16);
  cfg.psuL = clamp(num(cfg.psuL, 200), 140, 230);
  if (!(cfg.mains in MAINS)) cfg.mains = '230-10';
  return cfg;
}

// Lay out a grid of square fans inside a rectangle, choosing the size
// that covers the most area.
export function fanGrid(a0, a1, b0, b1, sizes = [140, 120]) {
  let best = { size: sizes[0], cols: 0, rows: 0, area: 0 };
  for (const size of sizes) {
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
  const stacked = cfg.layout === 'stacked';
  const compact = cfg.layout === 'compact';
  const staggered = cfg.layout === 'staggered';
  const n = cfg.gpuCount;
  const { wall } = C;
  const spine = mode.spine;
  const plenumH = stacked ? C.plenumH : 0;
  const floorLayer = stacked ? C.fanT : 0;
  const cardWatts = Math.round((card.watts * cfg.gpuLimit) / 100);
  const aio = cfg.cooler === 'aio';

  // ---- What each module needs for its contents -------------------------
  const radFront = C.radT + C.fanT + 8;
  const boardMargin = stacked ? 12 : 6;
  const boardDepth = 2 * wall + 2 * boardMargin + board.l;
  const stack = n * card.t + (n - 1) * cfg.cardGap;
  // At least deep enough for one row of 140 mm roof and side fans.
  const gpuNeedD = Math.max(wall + C.rearGap + stack + cfg.glassGap + C.glass, 160);
  const gpuNeedW = spine + card.l + C.tailGap + wall;
  const psuStripW = C.psu.h + C.psuStrip;
  const drawerNeedW = compact
    ? spine + 4 + board.w + 10 + psuStripW + wall
    : stacked ? spine + 4 + board.w + 74 + wall : spine + 4 + board.w + 30 + wall;

  // ---- Footprints ------------------------------------------------------
  let W, D, gpuW, gpuD, drawerW, drawerD, pod = null;
  if (staggered) {
    gpuW = Math.ceil(gpuNeedW);
    gpuD = Math.ceil(gpuNeedD);
    drawerW = Math.ceil(drawerNeedW);
    // The drawer sticks out `reach` mm past the glass (and always covers the
    // cards so every riser comes up through its lid).
    drawerD = Math.ceil(Math.max(boardDepth + (aio ? radFront : 0), gpuD + cfg.reach));
    const pw = C.psu.w + 2 * C.podSide + 2 * wall;
    const pd = cfg.psuL + C.podFront + 6 + 2 * wall;
    const ph = C.psu.h + 2 * wall + 6 + C.podTop;
    pod = { x0: drawerW, x1: drawerW + pw, z0: drawerD - pd, z1: drawerD, y0: C.feet, h: ph };
    W = Math.max(gpuW, pod.x1);
    D = Math.max(drawerD, gpuD);
  } else {
    const drawerFront = aio ? radFront : compact ? 0 : C.fanT + 8;
    const depthPsu = compact
      ? 2 * wall + cfg.psuL + 12
      : 2 * wall + (cfg.psuMode === 'dual' ? 2 * C.psu.w + 36 : C.psu.w + 24);
    D = Math.ceil(Math.max(boardDepth + drawerFront, gpuNeedD, depthPsu));
    W = Math.ceil(Math.max(
      gpuNeedW,
      drawerNeedW,
      stacked ? spine + cfg.psuL + 70 + wall : 0,
      stacked ? spine + C.riserBay + 130 + wall : 0,
    ));
    gpuW = drawerW = W;
    gpuD = drawerD = D;
  }

  // ---- Power module (stacked only) ---------------------------------------
  const hPower = stacked ? 2 * wall + 8 + C.psu.h + 14 : 0;
  const powerY0 = C.feet;
  const drawerY0 = powerY0 + hPower;

  // ---- Board drawer -----------------------------------------------------
  const compH = aio ? C.pumpH : cfg.coolerH;
  const innerComp = C.trayH + C.standoff + C.pcb + compH + 14;
  const frontSpace = drawerD - boardDepth;
  const wantsFrontFans = aio || frontSpace >= C.fanT + 8;
  const usableX = (compact ? drawerW - psuStripW : drawerW) - spine - 2 * wall;
  const innerPsu = compact ? C.psu.w + 12 : 0;
  // Staggered: keep the overhang fans clear of the PSU pod underneath.
  const innerUnder = staggered ? pod.h + C.underGap + C.fanT - 2 * wall : 0;

  // Front fans: pick the size that covers the most of the drawer front.
  let frontFan = { size: 120, count: 0 };
  if (wantsFrontFans && !aio) {
    const innerMax = Math.max(innerComp, innerPsu, innerUnder);
    for (const size of [140, 120]) {
      const count = size + 8 <= Math.max(innerMax, 128) ? clamp(Math.floor((usableX - 10) / (size + 6)), 0, 3) : 0;
      if (count * size * size > frontFan.count * frontFan.size * frontFan.size) frontFan = { size, count };
    }
  }
  const innerFront = aio ? 128 : frontFan.count ? frontFan.size + 8 : 0;
  const hDrawer = Math.ceil(2 * wall + Math.max(innerComp, innerFront, innerPsu, innerUnder));
  const boardX0 = spine + 4;
  const boardZ0 = wall + boardMargin;
  const boardTop = drawerY0 + wall + C.trayH + C.standoff + C.pcb;

  // Supplies. `s*` are the box sizes along X/Y/Z; `inlet` is the face with
  // the mains socket and `fan` the face the PSU fan breathes through.
  const psus = [];
  if (staggered) {
    psus.push({ x0: pod.x0 + wall + C.podSide, y0: pod.y0 + wall + 6, z0: pod.z0 + wall + 6, sx: C.psu.w, sy: C.psu.h, sz: cfg.psuL, inlet: '-z', fan: '+y' });
  } else if (compact) {
    psus.push({ x0: drawerW - wall - psuStripW + 4, y0: drawerY0 + wall + 6, z0: wall + 6, sx: C.psu.h, sy: C.psu.w, sz: cfg.psuL, inlet: '-z', fan: '+x' });
  } else {
    const count = cfg.psuMode === 'dual' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const zc = count === 1 ? D / 2 : D / 2 + (i === 0 ? 1 : -1) * (C.psu.w / 2 + 6);
      psus.push({ x0: spine, y0: powerY0 + wall + 8, z0: zc - C.psu.w / 2, sx: cfg.psuL, sy: C.psu.h, sz: C.psu.w, inlet: '-x', fan: '-y' });
    }
  }

  const fanSpanX0 = spine + wall;
  let drawerFans = [];
  let radiator = null;
  if (aio) {
    const radFans = clamp(Math.floor((usableX - 40) / 120), 2, 3);
    const len = radFans * 120 + 37;
    const x0 = fanSpanX0 + (usableX - len) / 2;
    radiator = { x0, len, fans: radFans, z1: drawerD - wall - 2 };
    drawerFans = Array.from({ length: radFans }, (_, i) => ({ x: x0 + 18.5 + 60 + i * 120, size: 120 }));
  } else if (frontFan.count) {
    const pitch = frontFan.size + 6;
    const cx = fanSpanX0 + usableX / 2;
    drawerFans = Array.from({ length: frontFan.count }, (_, i) => ({ x: cx + (i - (frontFan.count - 1) / 2) * pitch, size: frontFan.size }));
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
    const zFront = gpuD - C.glass - cfg.glassGap - i * (card.t + cfg.cardGap);
    cards.push({ index: i, x0: spine, y0: cardY0, z0: zFront - card.t, l: card.l, h: card.h, t: card.t, zPcb: zFront - card.t + 8 });
  }

  // Front card pairs with the front-most slot so the risers never cross.
  // Stacked: the riser bends in the plenum under the GPU chamber.
  // Otherwise it rises to just under the drawer lid, runs over the CPU
  // cooler to sit under its card, then goes up through the lid.
  const slotsFrontFirst = [...slotNumbers].sort((a, b) => b - a);
  const fingerX = spine + C.fingerStart + C.fingerLen / 2;
  const lidUnderside = gpuY0 - wall;
  const risers = cards.map((c, i) => {
    const slot = slotsFrontFirst[i];
    const from = { x: boardX0 + C.fingerStart + C.fingerLen / 2, y: boardTop + 11, z: boardZ0 + slotV(slot) };
    const to = { x: fingerX, y: chamberY0, z: c.zPcb };
    const points = stacked
      ? [from, { x: from.x, y: gpuY0 - 6, z: from.z }, { x: to.x, y: to.y - 22, z: to.z }, to]
      : [from, { x: from.x, y: lidUnderside - 6, z: from.z }, { x: to.x, y: lidUnderside - 6, z: to.z }, to];
    const through = stacked ? { x: from.x, z: from.z } : { x: to.x, z: to.z };
    const length = Math.ceil(riserLength(points) + 20);
    const buy = RISER_LENGTHS.find((l) => l >= length) ?? null;
    return { card: i, slot, lanes: laneFor(board, n, slot, slotNumbers), points, through, length, buy };
  });

  const noFans = { size: 140, fans: [] };
  const floorFans = stacked ? fanGrid(spine + C.riserBay, W - wall, wall, D - C.glass) : noFans;
  const roofFans = fanGrid(spine + wall, gpuW - wall, wall, gpuD - C.glass);
  const sideFans = fanGrid(wall, gpuD - C.glass, chamberY0, cardTop + C.cableTop - 4);
  // Staggered: the part of the GPU module that sticks out past the drawer
  // has intake fans hung under its floor, breathing from below.
  const overhang = staggered && gpuW - drawerW >= 96
    ? { x0: drawerW, x1: gpuW, z0: 0, z1: gpuD }
    : null;
  const underFans = overhang
    ? fanGrid(overhang.x0 + 2, overhang.x1 - wall - 2, wall + 4, gpuD - C.glass - 4, [140, 120, 92])
    : noFans;

  // ---- Budgets ----------------------------------------------------------
  const rearFan = stacked;
  const fanCount = floorFans.fans.length + roofFans.fans.length + sideFans.fans.length + underFans.fans.length
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

  const flowOf = (grid) => grid.fans.length * FAN_FLOW[grid.size];
  const intakeFree = flowOf(floorFans) + flowOf(sideFans) + flowOf(underFans);
  const exhaustFree = flowOf(roofFans);
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
      if (!stacked) fixes.push('switch to the stacked layout with two supplies');
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
  if (stacked && floorFans.fans.length === 0) warn('caution', 'No room for floor intake fans in the GPU module. Make the case wider.');
  if (!stacked && cfg.cooler === 'tower' && cfg.coolerH > 165) warn('caution', `A ${cfg.coolerH} mm cooler leaves the risers little room under the drawer lid. 160 mm or lower is easier.`);

  // Feet: corners of the footprint, or of the drawer plus the pod's far end.
  const feet = staggered
    ? [[spine + 40, 50], [drawerW - 40, 50], [spine + 40, drawerD - 50], [drawerW - 40, drawerD - 50], [pod.x1 - 34, pod.z0 + 34, 'pod'], [pod.x1 - 34, pod.z1 - 34, 'pod']]
    : [[60, 50], [W - 60, 50], [60, D - 50], [W - 60, D - 50]];

  // Volume of the modules themselves (the bounding box counts the air
  // around the parts that stick out).
  const bodyMm3 = spine * D * (H - C.feet)
    + (W - spine) * D * hPower
    + (drawerW - spine) * drawerD * hDrawer
    + (gpuW - spine) * gpuD * hGpu
    + (pod ? (pod.x1 - pod.x0) * (pod.z1 - pod.z0) * pod.h : 0);

  return {
    cfg, card, board, n, mode: cfg.layout, compact, stacked, staggered, spine, cardWatts,
    W, D, H,
    volumeL: Math.round((W * D * H) / 1e5) / 10,
    bodyL: Math.round(bodyMm3 / 1e5) / 10,
    slide: staggered ? 'z' : 'x',
    feet: feet.map(([x, z, on = 'base']) => ({ x, z, on })),
    power: { y0: powerY0, h: hPower, W, D, psus },
    pod,
    drawer: {
      y0: drawerY0, h: hDrawer, W: drawerW, D: drawerD,
      board: { x0: boardX0, z0: boardZ0, top: boardTop, w: board.w, l: board.l, socket: board.socket, dimms: board.dimms },
      slots: slotNumbers.map((k) => ({ number: k, z: boardZ0 + slotV(k) })),
      allSlots: [1, 2, 3, 4, 5, 6, 7].map((k) => ({ number: k, z: boardZ0 + slotV(k), used: slotNumbers.includes(k) })),
      cooler: cfg.cooler, coolerH: cfg.coolerH,
      fans: drawerFans, radiator, rearFan,
    },
    gpu: {
      y0: gpuY0, h: hGpu, W: gpuW, D: gpuD, plenumH, chamberY0, cardY0, cardTop,
      cards, floorFans, roofFans, sideFans, underFans, overhang,
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
