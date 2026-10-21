// polycolor model: pure logic, no DOM or audio. Spec: polycolor-spec.md.
// A dot is a color in HSL: hue (degrees) is its pitch class, sat is its own saturation (100 is the
// pure tone, less is grayer and noisier) and light is its own lightness (50 is the true color at
// full volume; toward black or white is quieter, and both ends are silent). Octave sets which
// octave that pitch class sounds in. The wheel's master saturation and lightness apply to every
// dot, like a master volume.

import {
  frequencyFromHue, hueFromFrequency, hslToRgb, rgbToHex, hexToRgb, rgbToHsl, labelInk,
  dbToGain, equalPowerMix, lightnessToDb, closeness, wavelengthFromFrequency, foldToWindow, LIFT_OCTAVES,
} from '../shared/color.js';
import { getTuning, snap, describePitch, formatCents, NOTE_NAMES, A4 } from '../shared/tuning.js';

export const MAX_DOTS = 12;

export const DEFAULT_OCTAVE = 4;
export const MIN_OCTAVE = 0;
export const MAX_OCTAVE = 8;

const mod = (n, m) => ((n % m) + m) % m;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const MINUS = '−';

// ---------- Pitch ----------

/** Cents from A4 and frequency for a dot's hue in its octave (octave 4 runs C4 to B4). */
export function pitchOf({ hue, octave = DEFAULT_OCTAVE }) {
  const base = frequencyFromHue(hue); // inside G4..F#5
  const fromA4 = 1200 * Math.log2(base / A4);
  const fromC = mod(fromA4 + 900 + 1e-4, 1200) - 1e-4; // C is 900 cents below A; the nudge keeps C itself from rounding up an octave
  const cents = (octave - DEFAULT_OCTAVE) * 1200 + fromC - 900;
  return { cents, freq: A4 * 2 ** (cents / 1200) };
}

/** The hue of the pitch `cents` from A4. */
export const hueFromCents = (cents) => hueFromFrequency(A4 * 2 ** (cents / 1200));

/** Snap a hue to the nearest note of the tuning (Free leaves it alone). */
export function snapHue(hue, tuningId) {
  if (!getTuning(tuningId).divisions) return hue;
  const { freq } = pitchOf({ hue, octave: DEFAULT_OCTAVE });
  return hueFromFrequency(snap(freq, tuningId));
}

/**
 * Snap every dot to the nearest note of a tuning. Returns the new state and how many dots moved
 * (a dot already on a note of the new tuning stays put). Free (Hz) has no notes: nothing moves.
 */
export function snapAll(state, tuningId) {
  let moved = 0;
  const dots = state.dots.map((d) => {
    const hue = snapHue(d.hue, tuningId);
    const diff = Math.abs(hue - d.hue);
    if (Math.min(diff, 360 - diff) < 0.01) return d;
    moved++;
    return { ...d, hue };
  });
  return { state: moved ? { ...state, dots } : state, moved };
}

/** Rotate a hue one note of the tuning up (+1) or down (-1). Free (Hz) has no notes: returns null. */
export function stepHue(hue, tuningId, dir) {
  const { divisions } = getTuning(tuningId);
  if (!divisions) return null;
  const { cents } = pitchOf({ hue, octave: DEFAULT_OCTAVE });
  const pos = (cents * divisions) / 1200;
  const nearest = Math.round(pos);
  const k = Math.abs(pos - nearest) < 1e-6 ? nearest + dir : dir > 0 ? Math.ceil(pos) : Math.floor(pos);
  return hueFromCents((k * 1200) / divisions);
}

// ---------- Color ----------

const NEUTRAL = Object.freeze({ sat: 100, light: 100 });

/**
 * A dot's lightness after the master lightness: the master scales how close the color is to the
 * true color (50%), keeping the dot on its own side, dark or light. At 100% nothing changes; at
 * 0% every color is black or white, and silent. A dot at exactly 50% is on the dark side.
 */
export function masterLightness(light, masterValue) {
  const side = light > 50 ? 1 : -1;
  return 50 + side * 50 * (1 - closeness(light) * (masterValue / 100));
}

/** The color a dot is drawn and sounds as, after the master sliders. */
export function finalColor(dot, master = NEUTRAL) {
  const s = (dot.sat * master.sat) / 100;
  const l = masterLightness(dot.light, master.light);
  const rgb = hslToRgb(dot.hue, s, l);
  return { h: dot.hue, s, l, rgb, hex: rgbToHex(...rgb).toUpperCase(), label: labelInk(...rgb) };
}

/** A typed final saturation back to the dot's own value (undoing the master). */
export function ownSatFromFinal(finalValue, masterValue) {
  return masterValue <= 0 ? finalValue : clamp((finalValue / masterValue) * 100, 0, 100);
}

/** A typed final lightness back to the dot's own value (undoing the master). */
export function ownLightFromFinal(finalLight, masterValue) {
  if (masterValue <= 0) return finalLight;
  const side = finalLight > 50 ? 1 : -1;
  const c = Math.min(1, closeness(finalLight) / (masterValue / 100));
  return 50 + side * 50 * (1 - c);
}

/** Gain for a dot's tone and noise parts, and the dot's loudness, from its final color. */
export function soundOf(dot, master) {
  const { s, l } = finalColor(dot, master);
  const db = lightnessToDb(l);
  return { gain: dbToGain(db), db, ...equalPowerMix(s), saturation: s };
}

export const formatHsl = (h, s, l) => `${Math.round(h) % 360}°, ${Math.round(s)}%, ${Math.round(l)}%`;
export const formatRgb = ([r, g, b]) => `rgb(${r} ${g} ${b})`;

/** "28°, 80%, 50%", "28 80 50" or "hsl(28, 80, 50)". null if it isn't one. */
export function parseHsl(text) {
  const m = /^\s*(?:hsl\()?\s*(\d+(?:\.\d+)?)\s*°?\s*[, ]\s*(\d+(?:\.\d+)?)\s*%?\s*[, ]\s*(\d+(?:\.\d+)?)\s*%?\s*\)?\s*$/i.exec(text);
  if (!m) return null;
  const [h, s, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 360 || s > 100 || l > 100) return null;
  return { h: h % 360, s, l };
}

/** "rgb(255 140 0)", "rgb(255, 140, 0)" or "255 140 0". null if it isn't one. */
export function parseRgb(text) {
  const m = /^\s*(?:rgb\(\s*)?(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?\s*$/i.exec(text);
  if (!m) return null;
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  return rgb.every((c) => c <= 255) ? rgb : null;
}

export const parseHex = hexToRgb;

/** Every hex code in pasted text (commas, spaces or new lines between), as RGB triples. */
export function parsePalette(text) {
  return text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean).map((t) => (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t) ? hexToRgb(t) : null)).filter(Boolean);
}

/** A dot for an RGB color (moves to match; the pitch follows the hue). */
export function dotFromRgb(rgb, id, octave = DEFAULT_OCTAVE) {
  const { h, s, l } = rgbToHsl(...rgb);
  return { id, name: null, hue: h, sat: s, light: l, octave };
}

// ---------- Wheel geometry ----------

/** A dot's place on the wheel as offsets from the center in -1..1 (angle = hue clockwise from the top). */
export function polar(hue, radius) {
  const a = (hue * Math.PI) / 180;
  const r = radius / 100;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

/**
 * The wheel's distance from the center is lightness above the true color: the rim is 50% (the pure
 * color) and the white center is 100%. A darker dot sits on the rim, and its swatch shows how dark.
 */
export const radiusOfLight = (light) => (light >= 50 ? (100 - light) * 2 : 100);
export const lightFromRadius = (radius) => 100 - Math.min(100, Math.max(0, radius)) / 2;

/**
 * One arrow press up (+1, out toward the true color) or down (-1, in toward white) in lightness.
 * From the dark side up and down both stay on that side until they reach 50%; a dot at 50% steps
 * down toward white.
 */
export function stepLight(light, dir, amount = 5) {
  if (light < 50) return dir > 0 ? Math.min(50, light + amount) : Math.max(0, light - amount);
  return dir > 0 ? Math.max(50, light - amount) : Math.min(100, light + amount);
}

/** The reverse of polar: hue and radius (0..100) for an offset from the center. */
export function fromOffset(x, y, previousHue = 0) {
  const r = Math.hypot(x, y);
  if (r < 1e-9) return { hue: previousHue, radius: 0 };
  return { hue: mod((Math.atan2(x, -y) * 180) / Math.PI, 360), radius: Math.min(100, r * 100) };
}

/**
 * Where a dragged dot goes: its hue and lightness from the pointer. A dark dot (below 50%) that
 * is dragged along the rim keeps its lightness; moving it inward makes it lighter from 50%.
 */
export function dragTo(dot, x, y) {
  const { hue, radius } = fromOffset(x, y, dot.hue);
  const light = dot.light < 50 && radius >= 97 ? dot.light : lightFromRadius(radius);
  return { hue, light };
}

/**
 * Tick marks for the rim. Every note of the tuning gets one; the 12-EDO notes are "named" and
 * labeled. Free (Hz) shows just the 12 named notes.
 */
export function wheelTicks(tuningId) {
  const { divisions } = getTuning(tuningId);
  const ticks = new Map();
  const add = (cents, name) => {
    const hue = Math.round(hueFromCents(cents) * 1000) / 1000;
    const prev = ticks.get(hue);
    ticks.set(hue, { hue, label: name ?? prev?.label ?? null, named: !!(name ?? prev?.named) });
  };
  NOTE_NAMES.forEach((name, i) => add((i - 9) * 100 - 1200, name)); // C4 up to B4
  if (divisions && divisions !== 12) for (let k = 0; k < divisions; k++) add((k * 1200) / divisions, null);
  return [...ticks.values()].sort((a, b) => a.hue - b.hue);
}

// ---------- Readouts ----------

export const dotName = (dot, index) => dot.name || `Color ${index + 1}`;

/** "A4 +3¢" and, in 19, 24 and 31-EDO, "step 7 of 19". */
export function noteReadout(dot, tuningId) {
  const { freq } = pitchOf(dot);
  const d = describePitch(freq, tuningId);
  return { text: d.textWithOctave, step: d.stepText ?? '', freq, hz: freq };
}

/** "484.0 THz · 620 nm", or "… · UV" past 380 nm. */
export function lightReadout(dot) {
  const { freq } = pitchOf(dot);
  const thz = (foldToWindow(freq) * 2 ** LIFT_OCTAVES) / 1e12;
  const nm = wavelengthFromFrequency(freq);
  return nm < 380 ? `${thz.toFixed(1)} THz · UV` : `${thz.toFixed(1)} THz · ${Math.round(nm)} nm`;
}

/** "Saturation 80% · noise 20%". */
export const saturationReadout = (sat) => `Saturation ${Math.round(sat)}% · noise ${Math.round(100 - sat)}%`;

/** "Lightness 25% · −9.0 dB" for a dot's own or final lightness. */
export function lightnessReadout(light) {
  const db = lightnessToDb(light);
  return `Lightness ${Math.round(light)}% · ${db === -Infinity ? `${MINUS}∞ dB` : db === 0 ? '0.0 dB' : `${MINUS}${Math.abs(db).toFixed(1)} dB`}`;
}

/** The master lightness: how much of every color's distance from black or white it keeps. */
export function masterLightnessReadout(m) {
  const db = m <= 0 ? -Infinity : 30 * Math.log10(m / 100);
  return `Lightness range ${Math.round(m)}% · ${db === -Infinity ? `${MINUS}∞ dB` : db === 0 ? '0.0 dB' : `${MINUS}${Math.abs(db).toFixed(1)} dB`}`;
}

/** The accessible name of a dot. */
export function describeDot(dot, index, tuningId, master) {
  const { text } = noteReadout(dot, tuningId);
  const c = finalColor(dot, master);
  const pitch = text.replace(/ ([+−])(\d+)¢$/, (_, sign, n) => ` ${sign === '+' ? 'plus' : 'minus'} ${n} cents`);
  return `${dotName(dot, index)}, ${pitch}, hue ${Math.round(c.h)}°, ${Math.round(c.s)}% saturation, ${Math.round(c.l)}% lightness`;
}

export { formatCents };

// ---------- Master volume ----------

/** Master slider 0..100 to gain, on the same 60 dB perceptual curve the color model used before it moved to lightness. */
export function masterGain(v) {
  if (v <= 0) return 0;
  return 10 ** ((60 * Math.log10(v / 100)) / 20);
}

// ---------- State ----------

export const DEFAULT_STATE = Object.freeze({
  dots: [],
  selected: null,
  masterSat: 100,
  masterLight: 100,
  tuning: '12-edo',
  snap: false,
  volume: 80,
  nextId: 1,
});

/** First visit: polytoggle's brand colors, the 3:4:5 major chord G, C and E (see site-spec.md, Poly). */
export function brandState() {
  const s = structuredClone(DEFAULT_STATE);
  // The sprinkle hexes are rounded, so give each dot its note's exact hue (G, C and E, no cents off).
  for (const [hex, hz] of [['#E60058', 391.995], ['#36E600', 523.251], ['#7700E6', 659.255]]) {
    const d = addDot(s, { ...dotFromRgb(hexToRgb(hex), 0), hue: hueFromFrequency(hz) });
    s.dots = d.dots; s.selected = d.selected; s.nextId = d.nextId;
  }
  s.selected = null;
  return s;
}

/** Merge saved state over the defaults, dropping anything malformed. */
export function restoreState(saved) {
  const s = structuredClone(DEFAULT_STATE);
  if (!saved || typeof saved !== 'object') return s;
  if (Array.isArray(saved.dots)) {
    // Older saves used brightness (HSB): brightness 100 is lightness 50.
    s.dots = saved.dots.slice(0, MAX_DOTS).filter((d) => d && Number.isInteger(d.id) && Number.isFinite(d.hue) && Number.isFinite(d.sat) && (Number.isFinite(d.light) || Number.isFinite(d.bri))).map((d) => ({
      id: d.id,
      name: typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 32 ? d.name : null,
      hue: mod(d.hue, 360),
      sat: clamp(d.sat, 0, 100),
      light: clamp(Number.isFinite(d.light) ? d.light : d.bri / 2, 0, 100),
      octave: Number.isInteger(d.octave) ? clamp(d.octave, MIN_OCTAVE, MAX_OCTAVE) : DEFAULT_OCTAVE,
    }));
  }
  s.nextId = Math.max(1, ...s.dots.map((d) => d.id + 1));
  if (s.dots.some((d) => d.id === saved.selected)) s.selected = saved.selected;
  if (Number.isFinite(saved.masterSat)) s.masterSat = clamp(saved.masterSat, 0, 100);
  if (Number.isFinite(saved.masterLight)) s.masterLight = clamp(saved.masterLight, 0, 100);
  else if (Number.isFinite(saved.masterBri)) s.masterLight = clamp(saved.masterBri, 0, 100);
  try { getTuning(saved.tuning); s.tuning = saved.tuning; } catch { /* keep default */ }
  if (typeof saved.snap === 'boolean') s.snap = saved.snap;
  if (Number.isFinite(saved.volume)) s.volume = clamp(saved.volume, 0, 100);
  return s;
}

// ---------- Palette edits (each returns a new state, or null when blocked) ----------

export function addDot(state, dot) {
  if (state.dots.length >= MAX_DOTS) return null;
  const d = { name: null, octave: DEFAULT_OCTAVE, ...dot, id: state.nextId };
  return { ...state, dots: [...state.dots, d], selected: d.id, nextId: state.nextId + 1 };
}

export function updateDot(state, id, patch) {
  if (!state.dots.some((d) => d.id === id)) return null;
  return { ...state, dots: state.dots.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

export function removeDot(state, id) {
  const i = state.dots.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const dots = state.dots.filter((d) => d.id !== id);
  const selected = state.selected === id ? (dots[Math.min(i, dots.length - 1)]?.id ?? null) : state.selected;
  return { ...state, dots, selected };
}

/** An exact copy right after the original, selected. null when 12 are in use. */
export function duplicateDot(state, id) {
  const i = state.dots.findIndex((d) => d.id === id);
  if (i < 0 || state.dots.length >= MAX_DOTS) return null;
  const copy = { ...state.dots[i], id: state.nextId };
  const dots = [...state.dots];
  dots.splice(i + 1, 0, copy);
  return { ...state, dots, selected: copy.id, nextId: state.nextId + 1 };
}

export function moveDot(state, id, to) {
  const i = state.dots.findIndex((d) => d.id === id);
  if (i < 0 || to < 0 || to >= state.dots.length || to === i) return null;
  const dots = [...state.dots];
  const [d] = dots.splice(i, 1);
  dots.splice(to, 0, d);
  return { ...state, dots };
}

/** Add several colors from pasted RGB triples, up to the limit. Returns { state, added, dropped }. */
export function addPalette(state, rgbs) {
  let s = state;
  let added = 0;
  for (const rgb of rgbs) {
    const next = addDot(s, dotFromRgb(rgb, 0));
    if (!next) break;
    s = next;
    added++;
  }
  return { state: s, added, dropped: rgbs.length - added };
}

export const newPalette = (state) => ({ ...state, dots: [], selected: null, nextId: 1 });

/** Rename: an empty name goes back to the default, over 32 characters is refused. */
export function renameDot(state, id, name) {
  const t = name.trim();
  if ([...t].length > 32) return null;
  return updateDot(state, id, { name: t || null });
}
