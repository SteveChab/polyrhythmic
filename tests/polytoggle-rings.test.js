import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringOrder, ringRadii, sectorPath, angleOf, ringLabel, ringsAria, HOLE, OUTER, GAP } from '../toggle/rings.js';

const L = (id, beats) => ({ id, name: id, beats });

test('the lane with the most beats is outermost; ties keep song order', () => {
  assert.deepEqual(ringOrder([L('a', 4), L('b', 8), L('c', 4), L('d', 6)]).map((l) => l.id), ['b', 'd', 'a', 'c']);
});

test('rings: 4 px apart, inside the hole, never thicker than 26 px', () => {
  for (const n of [1, 2, 4, 8]) {
    const r = ringRadii(n);
    assert.equal(r.length, n);
    assert.ok(r[0].outer <= OUTER && r.at(-1).inner >= HOLE - 1e-9);
    r.forEach((x, i) => { assert.ok(x.outer - x.inner <= 26 + 1e-9); if (i) assert.ok(Math.abs(r[i - 1].inner - x.outer - GAP) < 1e-9); });
  }
  assert.deepEqual(ringRadii(0), []);
});

test('sector paths close, and a full ring does not collapse', () => {
  assert.match(sectorPath(100, 120, 0, 90), /^M.*Z$/);
  assert.match(sectorPath(100, 120, 0, 360), /A120 120 0 1 1/);
});

test('beat 1 is at the top and a lane turns once per loop', () => {
  assert.equal(angleOf(0, 8), 0);
  assert.equal(angleOf(2, 8), 90);
  assert.equal(angleOf(7.5, 5), 540);
});

test('labels for the lane list and the figure', () => {
  assert.equal(ringLabel(0, 3, 8), 'Outer ring · 8 beats');
  assert.equal(ringLabel(1, 3, 6), 'Ring 2 · 6 beats');
  assert.equal(ringLabel(2, 3, 1), 'Inner ring · 1 beat');
  assert.equal(ringLabel(0, 1, 4), 'Only ring · 4 beats');
  assert.match(ringsAria([L('Snare', 8), L('Kick', 4)]), /^2 lanes as rings: Snare 8 beats outside, Kick 4 beats inside\.$/);
});
