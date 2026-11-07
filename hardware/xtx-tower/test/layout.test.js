import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, fanGrid, normalizeConfig, C } from '../js/layout.js';
import { GPUS, RISER_LENGTHS } from '../js/specs.js';

test('three reference cards fit with the default build', () => {
  const L = computeLayout({});
  assert.equal(L.n, 3);
  assert.equal(L.gpu.cards.length, 3);
  // Width is driven by the card length or the board, whichever is larger.
  assert.ok(L.W >= C.spine + GPUS.reference.l + C.tailGap);
  // Modules stack without gaps or overlap.
  assert.equal(L.drawer.y0, L.power.y0 + L.power.h);
  assert.equal(L.gpu.y0, L.drawer.y0 + L.drawer.h);
  assert.equal(L.H, L.gpu.y0 + L.gpu.h);
});

test('cards keep the requested gaps and stay inside the GPU module', () => {
  for (const gpu of ['reference', 'nitro', 'tuf']) {
    for (const gpuCount of [1, 2, 3, 4]) {
      const L = computeLayout({ gpu, gpuCount, cardGap: 30, glassGap: 25 });
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
});

test('risers pair front cards with front slots and round up to a stock length', () => {
  const L = computeLayout({ gpu: 'nitro', gpuCount: 3 });
  const slots = L.risers.map((r) => r.slot);
  assert.deepEqual(slots, [7, 4, 1]);
  for (const r of L.risers) {
    assert.ok(r.length > L.gpu.y0 - L.drawer.board.top, 'riser spans the drawer roof');
    assert.ok(RISER_LENGTHS.includes(r.buy));
    assert.ok(r.buy >= r.length);
  }
});

test('lane split follows the platform', () => {
  assert.deepEqual(computeLayout({ board: 'atx' }).risers.map((r) => r.lanes).sort(), ['x4 chipset', 'x8 CPU', 'x8 CPU']);
  assert.deepEqual(computeLayout({ board: 'eeb' }).risers.map((r) => r.lanes), ['x16', 'x16', 'x16']);
});

test('dual supplies split whole cards and flag overloads', () => {
  const L = computeLayout({ gpu: 'reference', psuMode: 'dual', psuWatts: 1000, cpuWatts: 250 });
  const [a, b] = L.budget.supplies;
  assert.equal(a.cards.length + b.cards.length, 3);
  assert.ok(a.feedsBoard && !b.feedsBoard);
  assert.equal(Math.round(a.load + b.load), L.budget.dcWatts);
  assert.ok(a.status === 'ok' && b.status === 'ok');

  const tight = computeLayout({ gpu: 'tuf', psuMode: 'single', psuWatts: 1200 });
  assert.equal(tight.budget.supplies[0].status, 'bad');
  assert.ok(tight.warnings.some((w) => w.level === 'bad' && w.text.includes('PSU')));
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
});

test('fan grid picks the size that covers the most area', () => {
  assert.equal(fanGrid(0, 300, 0, 300).size, 140);
  assert.equal(fanGrid(0, 300, 0, 300).fans.length, 4);
  assert.equal(fanGrid(0, 260, 0, 380).size, 120);
  assert.equal(fanGrid(0, 100, 0, 100).fans.length, 0);
});

test('bad input is clamped instead of breaking the layout', () => {
  const cfg = normalizeConfig({ gpuCount: 9, cardGap: -4, board: 'nope', psuWatts: 'x' });
  assert.equal(cfg.gpuCount, 4);
  assert.equal(cfg.cardGap, 5);
  assert.equal(cfg.board, 'atx');
  assert.equal(cfg.psuWatts, 1000);
  const L = computeLayout({ gpu: 'custom', gpuL: 9999, gpuH: 1, gpuT: 'abc' });
  assert.equal(L.card.l, 420);
  assert.equal(L.card.h, 90);
  assert.equal(L.card.t, GPUS.custom.t);
  assert.ok(Number.isFinite(L.H));
});
