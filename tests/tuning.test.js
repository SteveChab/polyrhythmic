import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNINGS, name12, describePitch, snap, centsOffTuning, formatCents, formatHz, stepFrequency } from '../shared/tuning.js';

test('the shared list, 12-EDO first', () => {
  assert.deepEqual(TUNINGS.map((t) => t.label), ['5-EDO', '7-EDO', '9-EDO', '12-EDO', '19-EDO', '24-EDO', '31-EDO', 'Free (Hz)']);
});

test('12-EDO names with scientific octaves', () => {
  assert.equal(name12(440).textWithOctave, 'A4');
  assert.equal(name12(261.6256).textWithOctave, 'C4');
  assert.equal(name12(82.4069).textWithOctave, 'E2');
  assert.equal(name12(246.9417).textWithOctave, 'B3');
});

test('nearest name plus cents, real minus sign', () => {
  const fs = 440 * 2 ** (-3 / 12) * 2 ** (5 / 1200);
  assert.equal(name12(fs).text, 'F# +5¢');
  assert.equal(name12(440 * 2 ** (-12 / 1200)).text, 'A −12¢');
  assert.equal(formatCents(-0.4), '0¢');
});

test('19-EDO: step k of N from A4 = step 0', () => {
  const d = describePitch(stepFrequency(7, 19), '19-edo');
  assert.equal(d.stepText, 'step 7 of 19');
  assert.equal(describePitch(stepFrequency(-1, 19), '19-edo').stepText, 'step 18 of 19');
  assert.equal(describePitch(440, '12-edo').stepText, undefined);
});

test('5, 7 and 9-EDO: step k of N, folded into the octave, A4 = step 0', () => {
  for (const n of [5, 7, 9]) {
    const id = `${n}-edo`;
    assert.equal(describePitch(440, id).stepText, `step 0 of ${n}`);
    assert.equal(describePitch(stepFrequency(1, n), id).stepText, `step 1 of ${n}`);
    assert.equal(describePitch(stepFrequency(-1, n), id).stepText, `step ${n - 1} of ${n}`);
    assert.equal(describePitch(stepFrequency(n, n), id).stepText, `step 0 of ${n}`);
    assert.equal(describePitch(stepFrequency(n + 2, n), id).stepText, `step 2 of ${n}`);
    assert.ok(Math.abs(centsOffTuning(stepFrequency(3, n), id)) < 1e-6);
  }
  // 5-EDO steps are 240¢: A4 + 240¢ is B4 + 40¢.
  assert.equal(describePitch(stepFrequency(1, 5), '5-edo').text, 'B +40¢');
});

test('24-EDO quarter tone names as a 12-EDO note plus 50 cents', () => {
  const d = describePitch(stepFrequency(1, 24), '24-edo');
  assert.equal(d.text, 'A +50¢');
});

test('snap and cents off tuning', () => {
  const f = 440 * 2 ** (13 / 1200);
  assert.equal(snap(f, '12-edo'), 440);
  assert.equal(snap(f, 'free'), f);
  assert.ok(Math.abs(centsOffTuning(f, '12-edo') - 13) < 1e-9);
  // 5:4 major third sits about 13.7 cents flat of 12-EDO
  assert.ok(Math.abs(centsOffTuning(440 * 1.25, '12-edo') + 13.69) < 0.01);
});

test('Hz formatting', () => {
  assert.equal(formatHz(440), '440 Hz');
  assert.equal(formatHz(27.5), '27.5 Hz');
  assert.equal(formatHz(1760), '1,760 Hz');
});

test('5, 7 and 9-EDO: step k of N, folded into the octave', () => {
  for (const n of [5, 7, 9]) {
    assert.equal(describePitch(stepFrequency(2, n), `${n}-edo`).stepText, `step 2 of ${n}`);
    assert.equal(describePitch(stepFrequency(-1, n), `${n}-edo`).stepText, `step ${n - 1} of ${n}`);
    assert.equal(describePitch(stepFrequency(n, n), `${n}-edo`).stepText, `step 0 of ${n}`);
    assert.ok(Math.abs(describePitch(stepFrequency(3, n), `${n}-edo`).offTuning) < 1e-9);
  }
  assert.ok(Math.abs(snap(stepFrequency(1, 5) * 1.01, '5-edo') - stepFrequency(1, 5)) < 1e-9);
});
