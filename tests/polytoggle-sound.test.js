import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as snd from '../polytoggle/sound.js';
import { INSTRUMENT_IDS } from '../polytoggle/song.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const env = (attackMs, decayMs, sustainPct, releaseMs) => ({ attackMs, decayMs, sustainPct, releaseMs });
const valueAt = (pts, t) => {
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) return pts[i - 1].v + ((pts[i].v - pts[i - 1].v) * (t - pts[i - 1].t)) / (pts[i].t - pts[i - 1].t);
  }
  return pts.at(-1).v;
};

test('envelope: rises to the peak over the attack, falls to sustain, releases to silence', () => {
  const pts = snd.adsrPoints(env(10, 200, 50, 100), 1, 1);
  assert.deepEqual(pts[0], { t: 0, v: 0 });
  near(valueAt(pts, 0.01), 1);
  near(valueAt(pts, 0.005), 0.5);
  near(valueAt(pts, 0.21), 0.5, 1e-9); // decay done, holding at sustain
  near(valueAt(pts, 0.6), 0.5);
  near(valueAt(pts, 1), 0.5);
  assert.equal(pts.at(-1).v, 0);
  near(pts.at(-1).t, 1.1);
  assert.ok(pts.every((p, i) => i === 0 || p.t > pts[i - 1].t), 'times strictly increase');
  assert.ok(pts.every((p) => p.v >= 0 && p.v <= 1));
});

test('envelope: sustain 0 dies away during the decay, even while the note is held', () => {
  const pts = snd.adsrPoints(env(2, 180, 0, 60), 1, 1);
  near(valueAt(pts, 0.002), 1);
  assert.ok(valueAt(pts, 0.1) < 0.5);
  near(valueAt(pts, 0.182), 0, 1e-9);
  near(valueAt(pts, 0.9), 0);
});

test('envelope: a note released early releases from where the curve had got to', () => {
  const mid = snd.adsrPoints(env(100, 200, 50, 100), 1, 0.05); // half way up the attack
  near(valueAt(mid, 0.05), 0.5);
  near(mid.at(-1).t, 0.15);
  const dec = snd.adsrPoints(env(10, 400, 20, 100), 1, 0.1); // part way down the decay
  const v = valueAt(dec, 0.1);
  assert.ok(v > 0.2 && v < 1);
  assert.equal(dec.at(-1).v, 0);
  const tiny = snd.adsrPoints(env(0, 0, 100, 0), 1, 0.01); // no clicks: floors on attack and release
  assert.ok(tiny[1].t >= 0.001 && tiny.at(-1).t - 0.01 >= 0.005 - 1e-12);
  assert.ok(tiny.every((p, i) => i === 0 || p.t > tiny[i - 1].t));
});

test('envelope: peak scales the curve; voiceLength adds the release', () => {
  const a = snd.adsrPoints(env(5, 100, 60, 80), 1, 0.5);
  const b = snd.adsrPoints(env(5, 100, 60, 80), 0.25, 0.5);
  a.forEach((p, i) => near(b[i].v, p.v / 4));
  near(snd.voiceLength(env(5, 100, 60, 80), 0.5), 0.58);
});

test('noise mix: pure tone at 0% noise, pure noise at 100%, equal power between', () => {
  assert.deepEqual(snd.toneNoiseGains(0), { tone: 1, noise: 0 });
  assert.deepEqual(snd.toneNoiseGains(100), { tone: 0, noise: 1 });
  let lastNoise = -1;
  for (let n = 0; n <= 100; n += 5) {
    const m = snd.toneNoiseGains(n);
    near(m.tone ** 2 + m.noise ** 2, 1, 1e-12);
    assert.ok(m.noise > lastNoise, 'noise rises steadily');
    lastNoise = m.noise;
  }
  // The noise comes in on a curve, so a note at 25% saturation (75% noise) still has a clear tone.
  assert.ok(snd.toneNoiseGains(75).tone > 0.5);
  assert.ok(snd.toneNoiseGains(50).tone > snd.toneNoiseGains(50).noise);
  assert.ok(snd.toneNoiseGains(99).tone > 0.015, 'the tone never vanishes before the very end');
});

test('noise band: narrow with little noise, wider as noise rises, none at 100%', () => {
  assert.equal(snd.noiseBandQ(100), null);
  let last = Infinity;
  for (let n = 0; n < 100; n += 5) {
    const q = snd.noiseBandQ(n);
    assert.ok(q < last && q > 0, `Q falls as noise rises (${n}%)`);
    last = q;
  }
  assert.ok(snd.noiseBandQ(10) > 5);
  assert.ok(snd.noiseBandQ(99) < 0.6);
});

test('note gain follows dB and is silent at the floor', () => {
  assert.equal(snd.noteGain(0), 1);
  near(snd.noteGain(-6), 0.5012, 1e-4);
  assert.equal(snd.noteGain(-60), 0);
});

test('every instrument has a voice', () => {
  for (const id of INSTRUMENT_IDS) {
    const v = snd.VOICES[id];
    assert.ok(v && v.tones.length > 0, id);
    assert.ok(v.tones.every((t) => ['sine', 'triangle', 'square', 'sawtooth'].includes(t.wave) && t.ratio > 0 && t.gain > 0), id);
  }
  assert.equal(Object.keys(snd.VOICES).length, INSTRUMENT_IDS.length);
});
