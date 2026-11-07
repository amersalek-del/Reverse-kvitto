import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, fanGrid, normalizeConfig, C } from '../js/layout.js';
import { GPUS, LAYOUTS, RISER_LENGTHS } from '../js/specs.js';

test('default build is three XFX Magnetic Air cards in the compact layout', () => {
  const L = computeLayout({});
  assert.equal(L.n, 3);
  assert.equal(L.mode, 'compact');
  assert.equal(L.card.key, 'magair');
  assert.deepEqual([L.card.l, L.card.h, L.card.t], [345, 135, 68]);
  assert.equal(L.spine, LAYOUTS.compact.spine);
  assert.ok(L.W >= L.spine + L.card.l + C.tailGap);
  // Modules stack without gaps or overlap.
  assert.equal(L.drawer.y0, L.power.y0 + L.power.h);
  assert.equal(L.gpu.y0, L.drawer.y0 + L.drawer.h);
  assert.equal(L.H, L.gpu.y0 + L.gpu.h);
});

test('compact is lower and smaller than stacked with the same parts', () => {
  for (const gpu of ['magair', 'reference', 'nitro', 'tuf']) {
    const compact = computeLayout({ gpu, layout: 'compact' });
    const stacked = computeLayout({ gpu, layout: 'stacked' });
    assert.equal(compact.power.h, 0, 'no power module');
    assert.equal(compact.gpu.plenumH, 0, 'no plenum');
    assert.equal(compact.gpu.floorFans.fans.length, 0);
    assert.ok(compact.H < stacked.H - 120, `${gpu}: height`);
    assert.ok(compact.volumeL < stacked.volumeL * 0.7, `${gpu}: volume`);
  }
});

test('compact PSU stands beside the board inside the drawer', () => {
  for (const cfg of [{}, { cooler: 'aio' }, { board: 'eatx' }, { psuL: 230 }]) {
    const L = computeLayout(cfg);
    const [p] = L.power.psus;
    const b = L.drawer.board;
    assert.equal(L.power.psus.length, 1);
    assert.ok(p.x0 >= b.x0 + b.w, 'clear of the board');
    assert.ok(p.x0 + p.sx <= L.W - C.wall, 'inside the right wall');
    assert.ok(p.y0 + p.sy <= L.drawer.y0 + L.drawer.h - C.wall, 'under the lid');
    assert.ok(p.z0 + p.sz <= L.D - C.wall, 'inside the front');
  }
});

test('compact allows only one supply; stacked allows two', () => {
  assert.equal(normalizeConfig({ layout: 'compact', psuMode: 'dual' }).psuMode, 'single');
  assert.equal(normalizeConfig({ layout: 'stacked', psuMode: 'dual' }).psuMode, 'dual');
});

test('cards keep the requested gaps and stay inside the GPU module', () => {
  for (const layout of ['compact', 'stacked']) {
    for (const gpu of ['magair', 'reference', 'nitro', 'tuf']) {
      for (const gpuCount of [1, 2, 3, 4]) {
        const L = computeLayout({ layout, gpu, gpuCount, cardGap: 30, glassGap: 25 });
        const cards = L.gpu.cards;
        assert.ok(Math.abs(L.D - C.glass - 25 - (cards[0].z0 + cards[0].t)) < 1e-9, 'front gap');
        for (let i = 1; i < cards.length; i++) {
          const gap = cards[i - 1].z0 - (cards[i].z0 + cards[i].t);
          assert.ok(Math.abs(gap - 30) < 1e-9, `gap between card ${i} and ${i + 1}`);
        }
        const rear = cards[cards.length - 1];
        assert.ok(rear.z0 >= C.wall + C.rearGap - 1e-9, 'rear clearance');
        assert.ok(rear.x0 + rear.l <= L.W - C.wall, 'card length');
        assert.ok(L.gpu.cardTop + C.cableTop <= L.H, 'cable room above the cards');
      }
    }
  }
});

test('risers pair front cards with front slots and round up to a stock length', () => {
  for (const layout of ['compact', 'stacked']) {
    const L = computeLayout({ layout, gpuCount: 3 });
    assert.deepEqual(L.risers.map((r) => r.slot), [7, 4, 1]);
    for (const r of L.risers) {
      assert.ok(r.length > L.gpu.y0 - L.drawer.board.top, 'riser spans the drawer');
      assert.ok(RISER_LENGTHS.includes(r.buy));
      assert.ok(r.buy >= r.length);
    }
  }
});

test('compact risers run between the CPU cooler and the drawer lid', () => {
  const L = computeLayout({ layout: 'compact', cooler: 'tower', coolerH: 160 });
  const coolerTop = L.drawer.board.top + 160;
  for (const r of L.risers) {
    const run = r.points[1].y;
    assert.equal(r.points[2].y, run, 'horizontal run');
    assert.ok(run - 1.5 > coolerTop, 'clears the cooler');
    assert.ok(run < L.gpu.y0 - C.wall, 'under the lid');
    assert.deepEqual(r.through, { x: r.points[3].x, z: r.points[3].z });
  }
});

test('lane split follows the platform', () => {
  assert.deepEqual(computeLayout({ board: 'atx' }).risers.map((r) => r.lanes).sort(), ['x4 chipset', 'x8 CPU', 'x8 CPU']);
  assert.deepEqual(computeLayout({ board: 'eeb' }).risers.map((r) => r.lanes), ['x16', 'x16', 'x16']);
});

test('dual supplies split whole cards and flag overloads', () => {
  const L = computeLayout({ layout: 'stacked', gpu: 'reference', psuMode: 'dual', psuWatts: 1000, cpuWatts: 250 });
  const [a, b] = L.budget.supplies;
  assert.equal(a.cards.length + b.cards.length, 3);
  assert.ok(a.feedsBoard && !b.feedsBoard);
  assert.equal(Math.round(a.load + b.load), L.budget.dcWatts);
  assert.ok(a.status === 'ok' && b.status === 'ok');

  const tight = computeLayout({ gpu: 'tuf', psuMode: 'single', psuWatts: 1200 });
  assert.equal(tight.budget.supplies[0].status, 'bad');
  assert.ok(tight.warnings.some((w) => w.level === 'bad' && w.text.includes('PSU')));
});

test('a power cap lowers the budget and the warning names the cap that fits', () => {
  const stock = computeLayout({ psuWatts: 1600 });
  const supply = stock.budget.supplies[0];
  assert.equal(supply.status, 'bad');
  const msg = stock.warnings.find((w) => w.text.startsWith('PSU runs'));
  assert.ok(msg.text.includes(`cap each card at about ${supply.capForOk} W`));

  const pct = Math.floor((supply.capForOk / GPUS.magair.watts) * 100);
  const capped = computeLayout({ psuWatts: 1600, gpuLimit: pct });
  assert.equal(capped.cardWatts, Math.round((GPUS.magair.watts * pct) / 100));
  assert.equal(capped.budget.supplies[0].status, 'ok');
  assert.ok(capped.airflow.deltaT < stock.airflow.deltaT);
  assert.ok(capped.budget.recommendedWatts <= 1600);
});

test('8-pin count is checked per supply', () => {
  const L = computeLayout({ gpu: 'nitro', psuMode: 'single', psuWatts: 1600, psuPcie: 6 });
  assert.equal(L.budget.supplies[0].pinsNeeded, 9);
  assert.ok(L.warnings.some((w) => w.text.includes('needs 9 PCIe 8-pin')));
});

test('a 120 V / 15 A circuit cannot carry three AIB cards', () => {
  const L = computeLayout({ gpu: 'nitro', mains: '120-15' });
  assert.equal(L.budget.circuit.status, 'bad');
  const eu = computeLayout({ gpu: 'reference', mains: '230-16' });
  assert.equal(eu.budget.circuit.status, 'ok');
});

test('airflow estimate scales with heat and fan count', () => {
  const one = computeLayout({ gpuCount: 1 });
  const three = computeLayout({ gpuCount: 3 });
  assert.ok(three.airflow.deltaT > one.airflow.deltaT);
  assert.ok(three.airflow.neededM3h > one.airflow.neededM3h);
  assert.ok(three.gpu.roofFans.fans.length >= 2);
  assert.ok(three.gpu.sideFans.fans.length >= 1);
});

test('fan grid picks the size that covers the most area', () => {
  assert.equal(fanGrid(0, 300, 0, 300).size, 140);
  assert.equal(fanGrid(0, 300, 0, 300).fans.length, 4);
  assert.equal(fanGrid(0, 260, 0, 380).size, 120);
  assert.equal(fanGrid(0, 100, 0, 100).fans.length, 0);
});

test('bad input is clamped instead of breaking the layout', () => {
  const cfg = normalizeConfig({ gpuCount: 9, cardGap: -4, board: 'nope', psuWatts: 'x', layout: 'tiny', gpu: 'nope', gpuLimit: 5 });
  assert.equal(cfg.gpuCount, 4);
  assert.equal(cfg.cardGap, 5);
  assert.equal(cfg.board, 'atx');
  assert.equal(cfg.psuWatts, 1600);
  assert.equal(cfg.layout, 'compact');
  assert.equal(cfg.gpu, 'magair');
  assert.equal(cfg.gpuLimit, 50);
  const L = computeLayout({ gpu: 'custom', gpuL: 9999, gpuH: 1, gpuT: 'abc' });
  assert.equal(L.card.l, 420);
  assert.equal(L.card.h, 90);
  assert.equal(L.card.t, GPUS.custom.t);
  assert.ok(Number.isFinite(L.H));
});
