import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hueFromFrequency, frequencyFromHue, wavelengthFromFrequency, foldToWindow, rgbToHex,
  hexToRgb, labelInk, noteColor, noiseMix, hslToRgb, rgbToHsl, lightnessToDb, dbToLightness, closeness,
} from '../shared/color.js';

const freq = (semisFromA4) => 440 * 2 ** (semisFromA4 / 12);
const NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

// site-spec.md, 12-EDO hue table.
const TABLE = { G: 337, 'G#': 0, A: 28, 'A#': 56, B: 80, C: 106, 'C#': 176, D: 206, 'D#': 244, E: 271, F: 292, 'F#': 314 };

const angle = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('every 12-EDO note matches the hue table (rounded to the degree)', () => {
  NAMES.forEach((n, i) => {
    const h = hueFromFrequency(freq(i));
    assert.ok(angle(Math.round(h) % 360, TABLE[n]) === 0, `${n}: got ${h.toFixed(2)}, table ${TABLE[n]}`);
  });
});

test('octave never changes hue', () => {
  for (const s of [-36, -13, 0, 7, 25]) {
    assert.ok(angle(hueFromFrequency(freq(s)), hueFromFrequency(freq(s + 12))) < 1e-9);
  }
});

test('fold window runs G4 to F#5', () => {
  assert.ok(Math.abs(foldToWindow(110) - 440) < 1e-9);
  assert.ok(Math.abs(foldToWindow(784) - 392) < 0.01); // G5 folds to G4
});

test('A4 lifts to about 620 nm', () => {
  assert.ok(Math.abs(wavelengthFromFrequency(440) - 620) < 1);
});

test('microtonal hues sit between their neighbours', () => {
  const h = hueFromFrequency(freq(4.5)); // between C# and D
  assert.ok(h > TABLE['C#'] && h < TABLE.D);
});

test('hue to pitch inverts pitch to hue across the octave', () => {
  for (let s = 0; s < 12; s += 0.37) {
    const f = foldToWindow(freq(s));
    const h = hueFromFrequency(f);
    if (h === 0) continue; // pure reds map to many pitches; G# stands for them
    const back = hueFromFrequency(frequencyFromHue(h));
    assert.ok(angle(back, h) < 0.01, `s=${s}: ${h} -> ${back}`);
  }
});

test('no step at F: the blend starts at F\'s true hue', () => {
  const below = hueFromFrequency(freq(8) * 2 ** (-1e-6 / 1200));
  const at = hueFromFrequency(freq(8));
  assert.ok(Math.abs(at - below) < 1e-3, `${below} vs ${at}`);
  assert.ok(Math.abs(at - 291.55) < 0.01);
});

test('hue 0 returns G#', () => {
  const f = frequencyFromHue(0);
  assert.ok(Math.abs(12 * Math.log2(f / freq(-1))) % 12 < 1e-6);
});

test('lightness is volume: 50% is the true color at full volume, black and white are silent', () => {
  assert.equal(lightnessToDb(50), 0);
  assert.ok(Math.abs(lightnessToDb(25) + 9.03) < 0.01);
  assert.ok(Math.abs(lightnessToDb(75) - lightnessToDb(25)) < 1e-12, 'light and dark are mirror images');
  assert.ok(Math.abs(lightnessToDb(5) + 30) < 0.01);
  assert.equal(lightnessToDb(0), -Infinity);
  assert.equal(lightnessToDb(100), -Infinity);
  assert.equal(closeness(50), 1);
  assert.equal(closeness(150), 0);
  // The dark side maps volume back to lightness: 0 dB is 50%, -9 dB is 25%, -60 dB is black.
  assert.equal(dbToLightness(0), 50);
  assert.ok(Math.abs(dbToLightness(-9.03) - 25) < 0.01);
  assert.equal(dbToLightness(-60), 0);
  assert.equal(dbToLightness(-Infinity), 0);
  assert.equal(dbToLightness(6), 50);
});

test('HSL: the vivid wheel is unchanged, desaturating goes gray, lightness goes to black and white', () => {
  assert.deepEqual(hslToRgb(200, 0, 50), [128, 128, 128]);
  assert.deepEqual(hslToRgb(200, 100, 0), [0, 0, 0]);
  assert.deepEqual(hslToRgb(200, 100, 100), [255, 255, 255]);
  assert.deepEqual(hslToRgb(200, 0, 100), [255, 255, 255]);
  const { h, s, l } = rgbToHsl(255, 119, 0);
  assert.ok(Math.abs(h - 28) < 0.01 && Math.abs(s - 100) < 1e-9 && Math.abs(l - 50) < 1e-9);
  assert.deepEqual(hslToRgb(...Object.values(rgbToHsl(40, 90, 200))), [40, 90, 200]);
});

test('design tokens: note colors at full S and B', () => {
  assert.equal(rgbToHex(...hslToRgb(28, 100, 50)), '#ff7700'); // note-a
  assert.equal(rgbToHex(...hslToRgb(106, 100, 50)), '#3cff00'); // note-c
  assert.equal(rgbToHex(...hslToRgb(271, 100, 50)), '#8400ff'); // note-e
});

test("Poly's sprinkles: G, C, E at 90% brightness", () => {
  assert.equal(rgbToHex(...hslToRgb(337, 100, 45)), '#e60058');
  assert.equal(rgbToHex(...hslToRgb(106, 100, 45)), '#36e600');
  assert.equal(rgbToHex(...hslToRgb(271, 100, 45)), '#7700e6');
});

test('label ink: black on bright notes, white on D# and E', () => {
  assert.equal(labelInk(...hexToRgb('#ff7700')), '#000000');
  assert.equal(labelInk(...hexToRgb('#1100ff')), '#ffffff');
  assert.equal(labelInk(...hexToRgb('#8400ff')), '#ffffff');
  assert.equal(labelInk(...hexToRgb('#d400ff')), '#000000');
});

test('hex parsing', () => {
  assert.deepEqual(hexToRgb('#f70'), [255, 119, 0]);
  assert.equal(hexToRgb('nope'), null);
});

test('noteColor: silence is black, noise mix follows saturation', () => {
  assert.equal(noteColor(440, { db: -Infinity }).hex, '#000000');
  const a = noteColor(440);
  assert.ok(Math.abs(a.h - 28) < 0.5 && a.hex.startsWith('#ff7'));
  assert.equal(noteColor(440, { db: -Infinity }).l, 0);
  assert.equal(noteColor(440, { saturation: 0 }).hex, '#808080', 'a noisy note is gray, not white');
  assert.equal(noteColor(440, { db: 30 * Math.log10(0.9) }).l.toFixed(1), '45.0');
  assert.deepEqual(noiseMix(25), { tone: 0.25, noise: 0.75 });
});

import { equalPowerMix, noiseBandMakeup, noiseBandQ, WHITE_NOISE_TRIM } from '../shared/color.js';

test('equal-power mix and the loudness of the noise band stay even across saturation', () => {
  assert.deepEqual(equalPowerMix(100), { tone: 1, noise: 0 });
  assert.deepEqual(equalPowerMix(0), { tone: 0, noise: 1 });
  assert.deepEqual(equalPowerMix(150), { tone: 1, noise: 0 });
  for (let s = 0; s <= 100; s += 10) {
    const m = equalPowerMix(s);
    assert.ok(Math.abs(m.tone ** 2 + m.noise ** 2 - 1) < 1e-12);
  }
  // Noise power after the band-pass times its makeup stays within about 3 dB of white noise
  // across the sweep, so there is no cliff at the ends (440 Hz at 48 kHz).
  const power = (s) => {
    const q = noiseBandQ(s);
    if (q === null) return 1;
    const enbw = (Math.PI / 2) * (440 / q);
    return Math.min(1, enbw / 24000) * noiseBandMakeup(q, 440, 48000) ** 2;
  };
  for (const s of [0, 1, 5, 20, 50, 90, 100]) {
    if (s === 100) continue;
    const db = 10 * Math.log10(power(s));
    assert.ok(Math.abs(db) < 3, `${s}%: ${db.toFixed(1)} dB`);
  }
  assert.equal(noiseBandMakeup(null, 440, 48000), 1);
  assert.ok(Math.abs(WHITE_NOISE_TRIM ** 2 / 3 - 0.5) < 1e-12);
});
