import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../polygrid/model.js';

test('slider is logarithmic from 0.25 Hz to 64 Hz, ticks at quarters', () => {
  assert.equal(m.sliderToHz(0), 0.25);
  assert.equal(m.sliderToHz(1000), 64);
  assert.ok(Math.abs(m.sliderToHz(250) - 1) < 1e-12);
  assert.ok(Math.abs(m.sliderToHz(500) - 4) < 1e-12);
  assert.ok(Math.abs(m.hzToPercent(16) - 75) < 1e-9);
});

test('grid columns are the LCM of active rows', () => {
  assert.equal(m.gridColumns([3, 4, 0]), 12);
  assert.equal(m.gridColumns([3, 4, 5]), 60);
  assert.equal(m.gridColumns([2, 3, 4]), 12);
  assert.equal(m.gridColumns([0, 0, 0]), 0);
  assert.equal(m.gridColumns([16, 20, 25]), 400);
  assert.equal(m.gridShort([16, 20, 25]), '400 columns · too fine to draw');
});

test('presets match the spec table grid sizes', () => {
  const g = Object.fromEntries(m.GRID_PRESETS.map((p) => [p.name, m.gridColumns(p.rows)]));
  assert.deepEqual(g, { 'Halves and thirds': 6, 'Thirds and quarters': 12, 'The 12-column web grid': 12, 'Three, four and five': 60, 'Major triad': 60 });
  for (const p of m.ALL_PRESETS) assert.ok(p.rows.every((n) => n <= 25));
});

test('snap puts the lowest row exactly on a note; ratios unchanged', () => {
  const hz = m.effectiveHz(10.3, [3, 4, 5], { snap: true, tuning: '12-edo' });
  const low = 3 * hz;
  const steps = 12 * Math.log2(low / 440);
  assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9);
  assert.equal(m.effectiveHz(10.3, [3, 4, 5], { snap: true, tuning: 'free' }), 10.3);
  assert.equal(m.effectiveHz(10.3, [3, 4, 5], { snap: false }), 10.3);
});

test('chord offsets: 4:5:6 is 14 cents off 12-EDO, 5 off 31-EDO, exact in Free', () => {
  assert.equal(m.chordOffCents([4, 5, 6], '12-edo'), 14);
  assert.equal(m.chordOffCents([4, 5, 6], '31-edo'), 5);
  assert.equal(m.chordOffCents([4, 5, 6], 'free'), null);
});

test('chords menu is sorted closest first, ties keep spec order', () => {
  const [, chords] = m.presetGroups('12-edo');
  const offs = chords.items.map((i) => m.chordOffCents(i.preset.rows, '12-edo'));
  for (let i = 1; i < offs.length; i++) assert.ok(offs[i] >= offs[i - 1]);
  assert.equal(chords.title, 'Chords · 12-EDO');
  const [, free] = m.presetGroups('free');
  assert.equal(free.items[0].preset.name, 'Minor triad');
  assert.match(free.items[0].meta, /exact in Free \(Hz\)/);
});

test('speed label switches to Hz at 2', () => {
  assert.equal(m.speedLabel(0.5), '30.0 cycles a minute');
  assert.equal(m.speedLabel(1.99), '119 cycles a minute');
  assert.equal(m.speedLabel(2), '2.00 Hz');
  assert.equal(m.speedLabel(32.7), '32.7 Hz');
});

test('color fades from 3 to 20 beats a second', () => {
  assert.equal(m.colorAmount(2), 0);
  assert.equal(m.colorAmount(3), 0);
  assert.equal(m.colorAmount(20), 1);
  const mid = m.colorAmount(Math.sqrt(60));
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
});

test('note lines: slow rows are not a pitch yet; tones get names and steps', () => {
  assert.deepEqual(m.noteLine(3, 0.5, { tuning: '12-edo' }), { tone: false, lead: '1.50 beats a second', rest: ' · not a pitch yet' });
  const a = m.noteLine(4, 110, { tuning: '12-edo' });
  assert.equal(a.lead, '440.0 Hz');
  assert.equal(a.rest, ' · A4');
  const b = m.noteLine(5, 110, { tuning: '19-edo', snapped: false });
  assert.match(b.rest, /C#5 −14¢ · step 6 of 19 · \+7¢ off/);
  assert.match(m.noteLine(4, 110, { tuning: '12-edo', snapped: true }).rest, /snapped$/);
});

test('grid text and caption', () => {
  assert.equal(m.gridText([3, 4, 5]), 'Rows realign every 60 units: a 60-column grid.');
  assert.equal(m.gridText([0, 7, 0]), 'One row of 7: a 7-column grid.');
  assert.equal(m.pageCaption([3, 4, 5]), '3, 4 and 5 columns on one 60-column page');
});

test('volume: floor and mute are silent', () => {
  assert.equal(m.rowGain(-60, false), 0);
  assert.equal(m.rowGain(0, true), 0);
  assert.equal(m.rowGain(0, false), 1);
  assert.equal(m.dbText(-3), '−3.0 dB');
  assert.equal(m.masterGain(0), 0);
  assert.equal(m.masterGain(100), 1);
});

test('restoreState keeps good fields and drops bad ones', () => {
  const s = m.restoreState({ beats: [5, 99, 0], db: [0, -6, -12], tuning: 'nope', snap: true, preset: null });
  assert.deepEqual(s.beats, [3, 4, 0]);
  assert.deepEqual(s.db, [0, -6, -12]);
  assert.equal(s.tuning, '12-edo');
  assert.equal(s.snap, true);
  assert.equal(s.preset, null);
});
