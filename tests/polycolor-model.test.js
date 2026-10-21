import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../polycolor/model.js';
import { hueFromFrequency } from '../shared/color.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const hueOfNote = (name) => ({ G: 337, 'G#': 0, A: 28, 'A#': 56, B: 80, C: 106, 'C#': 176, D: 206, 'D#': 244, E: 271, F: 292, 'F#': 314 })[name];

test('a dot sounds the note of its hue, in its octave', () => {
  const a = m.pitchOf({ hue: hueFromFrequency(440), octave: 4 });
  near(a.freq, 440, 1e-6);
  near(a.cents, 0, 1e-6);
  near(m.pitchOf({ hue: hueFromFrequency(440), octave: 5 }).freq, 880, 1e-6);
  near(m.pitchOf({ hue: hueFromFrequency(440 * 2 ** (3 / 12)), octave: 4 }).freq, 261.6256, 1e-3); // C hue at octave 4 is C4
  near(m.pitchOf({ hue: hueFromFrequency(392), octave: 4 }).freq, 392, 1e-6); // G4
  assert.equal(m.noteReadout({ hue: hueFromFrequency(440), octave: 4 }, '12-edo').text, 'A4');
  assert.equal(m.noteReadout({ hue: hueFromFrequency(440 * 2 ** (3 / 12)), octave: 4 }, '12-edo').text, 'C4');
});

test('every 12-EDO hue in the table maps to its own note', () => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (const n of names) {
    const hue = hueOfNote(n);
    const t = m.noteReadout({ hue: m.snapHue(hue, '12-edo'), octave: 4 }, '12-edo').text;
    assert.ok(t.startsWith(n) && !/[+−]/.test(t), `${n} -> ${t}`);
  }
});

test('snapping puts the hue on a note of the tuning; Free leaves it alone', () => {
  const near12 = m.snapHue(hueOfNote('A') + 3, '12-edo');
  assert.equal(m.noteReadout({ hue: near12, octave: 4 }, '12-edo').text, 'A4');
  assert.equal(m.snapHue(100, 'free'), 100);
  const s19 = m.snapHue(40, '19-edo');
  near(m.snapHue(s19, '19-edo'), s19, 1e-6); // already on a step
});

test('stepping rotates one note of the tuning, round the octave', () => {
  let hue = m.snapHue(hueOfNote('C'), '12-edo');
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(m.noteReadout({ hue, octave: 4 }, '12-edo').text);
    hue = m.stepHue(hue, '12-edo', 1);
  }
  assert.deepEqual(seen, ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4']);
  assert.equal(m.noteReadout({ hue, octave: 4 }, '12-edo').text, 'C4'); // wrapped
  const back = m.stepHue(m.snapHue(hueOfNote('A'), '12-edo'), '12-edo', -1);
  assert.equal(m.noteReadout({ hue: back, octave: 4 }, '12-edo').text, 'G#4');
  assert.equal(m.stepHue(100, 'free', 1), null);
  const h19 = m.stepHue(m.snapHue(10, '19-edo'), '19-edo', 1);
  assert.match(m.noteReadout({ hue: h19, octave: 4 }, '19-edo').step, /^step \d+ of 19$/);
});

test('master saturation grays every color; master lightness keeps each on its own side of the true color', () => {
  const dot = { hue: 28, sat: 100, light: 50 };
  const c = m.finalColor(dot, { sat: 80, light: 100 });
  near(c.s, 80);
  near(c.l, 50);
  assert.equal(m.finalColor(dot).hex, '#FF7700');
  // Master 50%: a true-color dot goes to 25% lightness (dark side), a light dot goes lighter, a dark one darker.
  near(m.masterLightness(50, 50), 25);
  near(m.masterLightness(75, 50), 87.5);
  near(m.masterLightness(25, 50), 12.5);
  near(m.masterLightness(60, 100), 60);
  assert.equal(m.masterLightness(50, 0), 0);
  assert.equal(m.masterLightness(80, 0), 100);
  // Typed values undo the master.
  assert.equal(m.ownSatFromFinal(80, 80), 100);
  near(m.ownSatFromFinal(40, 80), 50);
  assert.equal(m.ownSatFromFinal(90, 0), 90);
  assert.equal(m.ownSatFromFinal(100, 50), 100); // capped
  for (const [light, master] of [[30, 60], [80, 60], [50, 100], [90, 25]]) {
    near(m.ownLightFromFinal(m.masterLightness(light, master), master), light, 1e-9);
  }
});

test('sound: lightness is volume with white and black both silent, saturation is noise', () => {
  const master = { sat: 100, light: 100 };
  near(m.soundOf({ hue: 28, sat: 100, light: 25 }, master).db, -9.03, 0.01); // a darker note stays audible
  near(m.soundOf({ hue: 28, sat: 100, light: 75 }, master).db, -9.03, 0.01); // and so does a lighter one
  near(m.soundOf({ hue: 28, sat: 100, light: 5 }, master).db, -30, 0.01);
  const full = m.soundOf({ hue: 28, sat: 100, light: 50 }, master);
  assert.equal(full.gain, 1);
  assert.deepEqual([full.tone, full.noise], [1, 0]);
  const noisy = m.soundOf({ hue: 28, sat: 20, light: 50 }, master);
  near(noisy.noise ** 2 + noisy.tone ** 2, 1); // equal power: the two always add to the same power
  assert.ok(noisy.noise > noisy.tone);
  assert.equal(m.soundOf({ hue: 28, sat: 100, light: 0 }, master).gain, 0);
  assert.equal(m.soundOf({ hue: 28, sat: 100, light: 100 }, master).gain, 0, 'white is as silent as black');
  assert.equal(m.soundOf({ hue: 28, sat: 0, light: 50 }, master).noise, 1, 'mid-gray is full-volume noise');
});

test('readouts', () => {
  assert.equal(m.saturationReadout(80), 'Saturation 80% · noise 20%');
  assert.equal(m.lightnessReadout(50), 'Lightness 50% · 0.0 dB');
  assert.equal(m.lightnessReadout(25), 'Lightness 25% · −9.0 dB');
  assert.equal(m.lightnessReadout(100), 'Lightness 100% · −∞ dB');
  assert.equal(m.masterLightnessReadout(100), 'Lightness range 100% · 0.0 dB');
  assert.match(m.lightReadout({ hue: hueFromFrequency(440), octave: 4 }), /^483\.\d THz · 6\d\d nm$/);
  assert.match(m.lightReadout({ hue: hueFromFrequency(740), octave: 4 }), /UV$/);
  assert.equal(m.formatHsl(28.4, 80.2, 50), '28°, 80%, 50%');
  assert.equal(m.formatRgb([255, 140, 0]), 'rgb(255 140 0)');
});

test('parsing HSL, RGB, hex and pasted palettes', () => {
  assert.deepEqual(m.parseHsl('28°, 80%, 50%'), { h: 28, s: 80, l: 50 });
  assert.deepEqual(m.parseHsl('hsl(28 80 50)'), { h: 28, s: 80, l: 50 });
  assert.equal(m.parseHsl('400, 80, 50'), null);
  assert.equal(m.parseHsl('nope'), null);
  assert.deepEqual(m.parseRgb('rgb(255 140 0)'), [255, 140, 0]);
  assert.deepEqual(m.parseRgb('255, 140, 0'), [255, 140, 0]);
  assert.equal(m.parseRgb('256 0 0'), null);
  assert.deepEqual(m.parseHex('#FF8C00'), [255, 140, 0]);
  assert.deepEqual(m.parsePalette('#ff8c00, 00ff00\n#00f   nonsense #12345'), [[255, 140, 0], [0, 255, 0], [0, 0, 255]]);
});

test('wheel geometry: angle is hue, distance from the center is lightness above the true color', () => {
  const top = m.polar(0, 100);
  near(top.x, 0); near(top.y, -1);
  const right = m.polar(90, 50);
  near(right.x, 0.5); near(right.y, 0);
  for (const [h, r] of [[0, 100], [28, 80], [200, 35], [359, 100]]) {
    const p = m.polar(h, r);
    const back = m.fromOffset(p.x, p.y);
    near(back.hue, h, 1e-9); near(back.radius, r, 1e-9);
  }
  assert.equal(m.fromOffset(0, 0, 123).hue, 123);
  assert.equal(m.fromOffset(3, 4).radius, 100);
  // The rim is 50% (the pure color) and the white center is 100%.
  assert.equal(m.radiusOfLight(50), 100);
  assert.equal(m.radiusOfLight(100), 0);
  assert.equal(m.radiusOfLight(75), 50);
  assert.equal(m.radiusOfLight(20), 100, 'a dark dot sits on the rim');
  assert.equal(m.lightFromRadius(100), 50);
  assert.equal(m.lightFromRadius(0), 100);
  assert.equal(m.lightFromRadius(50), 75);
  // Dragging a dark dot along the rim keeps it dark; dragging it inward makes it lighter from 50%.
  assert.equal(m.dragTo({ hue: 10, light: 20 }, 0, -1).light, 20);
  assert.equal(m.dragTo({ hue: 10, light: 20 }, 0, -0.5).light, 75);
  assert.equal(m.dragTo({ hue: 10, light: 80 }, 0, -1).light, 50);
  assert.equal(m.dragTo({ hue: 10, light: 80 }, 0, 0).light, 100);
});

test('accessible name', () => {
  const dot = { id: 1, name: null, hue: hueFromFrequency(440 * 2 ** (4 / 1200)), sat: 80, light: 50, octave: 4 };
  assert.equal(m.describeDot(dot, 1, '12-edo', { sat: 100, light: 100 }), 'Color 2, A4 plus 4 cents, hue 29°, 80% saturation, 50% lightness');
  assert.equal(m.describeDot({ ...dot, name: 'Sky' }, 1, '12-edo', { sat: 100, light: 100 }).split(',')[0], 'Sky');
});

test('palette edits: add (max 12), update, duplicate, reorder, remove, rename, new', () => {
  let s = m.restoreState(null);
  s = m.addDot(s, { hue: 28, sat: 100, light: 50 });
  s = m.addDot(s, { hue: 106, sat: 100, light: 50 });
  assert.deepEqual(s.dots.map((d) => d.id), [1, 2]);
  assert.equal(s.selected, 2);
  assert.equal(m.updateDot(s, 1, { sat: 50 }).dots[0].sat, 50);
  assert.equal(m.updateDot(s, 99, {}), null);
  const dup = m.duplicateDot(s, 1);
  assert.deepEqual(dup.dots.map((d) => d.id), [1, 3, 2]);
  assert.equal(dup.selected, 3);
  assert.deepEqual(m.moveDot(dup, 2, 0).dots.map((d) => d.id), [2, 1, 3]);
  assert.equal(m.moveDot(dup, 2, 9), null);
  const gone = m.removeDot(dup, 3);
  assert.equal(gone.selected, 2);
  assert.equal(m.renameDot(s, 1, '  Sky ').dots[0].name, 'Sky');
  assert.equal(m.renameDot(s, 1, '   ').dots[0].name, null);
  assert.equal(m.renameDot(s, 1, 'x'.repeat(33)), null);
  assert.deepEqual(m.newPalette(dup).dots, []);
  let full = m.restoreState(null);
  for (let i = 0; i < 12; i++) full = m.addDot(full, { hue: i * 30, sat: 100, light: 50 });
  assert.equal(full.dots.length, 12);
  assert.equal(m.addDot(full, { hue: 0, sat: 100, light: 50 }), null);
  assert.equal(m.duplicateDot(full, 1), null);
});

test('pasting a palette adds a dot per color up to the limit', () => {
  const s0 = m.restoreState(null);
  const { state, added, dropped } = m.addPalette(s0, Array.from({ length: 14 }, (_, i) => [i * 10, 255 - i * 10, 128]));
  assert.equal(state.dots.length, 12);
  assert.equal(added, 12);
  assert.equal(dropped, 2);
  const d = m.dotFromRgb([255, 119, 0], 5);
  near(d.hue, 28.0, 0.5);
  near(d.sat, 100); near(d.light, 50);
});

test('state is restored defensively', () => {
  assert.deepEqual(m.restoreState('junk').dots, []);
  const s = m.restoreState({
    dots: [{ id: 3, name: 'A', hue: 400, sat: 120, light: -5, octave: 12 }, { id: 'x' }, null],
    selected: 3, masterSat: 50, masterLight: 'no', tuning: 'bogus', snap: false, volume: 30,
  });
  assert.equal(s.dots.length, 1);
  assert.deepEqual([s.dots[0].hue, s.dots[0].sat, s.dots[0].light, s.dots[0].octave], [40, 100, 0, 8]);
  assert.equal(s.selected, 3);
  assert.equal(s.nextId, 4);
  assert.equal(s.masterSat, 50);
  assert.equal(s.masterLight, 100);
  assert.equal(s.tuning, '12-edo');
  assert.equal(s.snap, false);
});

test('master volume curve', () => {
  assert.equal(m.masterGain(0), 0);
  assert.equal(m.masterGain(100), 1);
  near(m.masterGain(50), 10 ** (-18.06 / 20), 1e-3);
});

test('arrow keys: up goes out toward the true color, down goes in toward white', () => {
  assert.equal(m.stepLight(75, 1), 70);
  assert.equal(m.stepLight(52, 1), 50);
  assert.equal(m.stepLight(50, 1), 50);
  assert.equal(m.stepLight(50, -1), 55);
  assert.equal(m.stepLight(98, -1), 100);
  assert.equal(m.stepLight(30, 1), 35, 'a dark dot moves toward 50 with up');
  assert.equal(m.stepLight(48, 1), 50);
  assert.equal(m.stepLight(30, -1, 1), 29);
  assert.equal(m.stepLight(2, -1), 0);
});

test('an older save made with brightness opens as lightness', () => {
  const s = m.restoreState({ dots: [{ id: 1, hue: 28, sat: 100, bri: 100 }, { id: 2, hue: 106, sat: 50, bri: 60 }], masterBri: 40, selected: 1 });
  assert.deepEqual(s.dots.map((d) => d.light), [50, 30]);
  assert.equal(s.masterLight, 40);
});

test('changing tuning with Snap on moves each color to the nearest note of the new tuning', () => {
  let s = m.restoreState(null);
  const onA = m.snapHue(hueOfNote('A'), '12-edo');
  s = m.addDot(s, { hue: onA, sat: 100, light: 50 });
  s = m.addDot(s, { hue: 100, sat: 100, light: 50 }); // between notes
  const same = m.snapAll(s, '12-edo');
  assert.equal(same.moved, 1, 'only the dot between notes moves');
  const to19 = m.snapAll(same.state, '19-edo');
  assert.ok(to19.moved >= 1);
  for (const d of to19.state.dots) near(m.snapHue(d.hue, '19-edo'), d.hue, 0.01);
  assert.equal(m.snapAll(s, 'free').moved, 0);
  assert.equal(m.snapAll(m.restoreState(null), '19-edo').moved, 0);
  assert.equal(m.snapAll(to19.state, '19-edo').state, to19.state, 'nothing to move returns the same state');
});

test('the first-visit chord is G, C and E exactly', () => {
  const s = m.brandState();
  assert.equal(s.dots.length, 3);
  for (const [dot, hz] of s.dots.map((d, i) => [d, [392, 523.25, 659.26][i]])) {
    const p = m.pitchOf(dot);
    assert.ok(Math.abs(p.cents - Math.round(p.cents / 100) * 100) < 0.5, `${p.cents}¢ off a note`);
    assert.ok(Math.abs(p.freq / 2 ** (Math.round(Math.log2(p.freq / hz))) - hz) < 1, `${p.freq} Hz`);
  }
});
