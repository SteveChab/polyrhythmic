import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROW_TICKS, tickTrainCoefficients, rateGain, toneTrim, tickBalance, heardPower, LOUDNESS_REF } from '../grid/sound.js';

const series = ({ real, imag }, rate, t) => {
  let x = 0;
  for (let k = 1; k < real.length; k++) x += real[k] * Math.cos(2 * Math.PI * k * rate * t) + imag[k] * Math.sin(2 * Math.PI * k * rate * t);
  return x;
};
const power = ({ real, imag }) => { let p = 0; for (let k = 1; k < real.length; k++) p += (real[k] ** 2 + imag[k] ** 2) / 2; return p; };
const dB = (x) => 10 * Math.log10(x);

for (const [r, tk] of ROW_TICKS.entries()) {
  const name = `Row ${r + 1} (${tk.peakHz} Hz tick)`;

  test(`${name}: short, silent at both ends, peak 1`, () => {
    assert.ok(tk.length < 0.005);
    assert.ok(Math.abs(tk.at(0)) < 0.01 && Math.abs(tk.at(tk.length)) < 0.01);
    let peak = 0; for (let t = 0; t < tk.length; t += 1e-6) peak = Math.max(peak, Math.abs(tk.at(t)));
    assert.ok(Math.abs(peak - 1) < 0.01);
  });

  test(`${name}: at the fuse point the oscillator wave is the tick train itself`, () => {
    const c = tickTrainCoefficients(20, tk, 48000);
    let worst = 0;
    for (let t = 0; t < 1 / 20; t += 0.0001) worst = Math.max(worst, Math.abs(series(c, 20, t) - tk.at(t)));
    assert.ok(worst < 0.03, `worst error ${worst}`);
  });

  test(`${name}: every tone is as loud as the hand-over (A-weighted, within 0.1 dB)`, () => {
    const c20 = tickTrainCoefficients(20, tk, 48000);
    const ref = heardPower(c20, 20) * rateGain(20) ** 2;
    assert.ok(Math.abs(toneTrim(c20, 20, tk) - 1) < 1e-6, 'no jump at the hand-over');
    for (const rate of [25, 60, 200, 600, 1000, 1600]) {
      const c = tickTrainCoefficients(rate, tk, 48000);
      const p = heardPower(c, rate) * (rateGain(rate) * toneTrim(c, rate, tk)) ** 2;
      assert.ok(Math.abs(dB(p / ref)) < 0.1, `${rate}: ${dB(p / ref).toFixed(2)} dB`);
    }
  });

  test(`${name}: the pitch is the rate, whatever the tick`, () => {
    // The wave repeats exactly every 1/rate seconds, so its fundamental is the rate.
    const rate = 130.81;
    const c = tickTrainCoefficients(rate, tk, 48000);
    for (const t of [0.0003, 0.001, 0.004]) assert.ok(Math.abs(series(c, rate, t) - series(c, rate, t + 1 / rate)) < 1e-6);
  });
}

test('the three ticks sound equally loud once balanced', () => {
  const heard = ROW_TICKS.map((tk) => heardPower(tickTrainCoefficients(20, tk, 48000), 20) * tickBalance(tk) ** 2);
  for (const h of heard) assert.ok(Math.abs(dB(h / heard[1])) < 0.01);
});

test('slow tick trains keep their level up to the reference rate, then hold power', () => {
  const p = (r) => power(tickTrainCoefficients(r, ROW_TICKS[1], 48000)) * rateGain(r) ** 2;
  assert.ok(Math.abs(dB(p(LOUDNESS_REF) / p(16))) < 0.5);
});

test('rate gain is continuous and falls only above the reference', () => {
  assert.equal(rateGain(1), 1);
  assert.equal(rateGain(LOUDNESS_REF), 1);
  assert.ok(Math.abs(rateGain(1600) - Math.sqrt(LOUDNESS_REF / 1600)) < 1e-12);
});
