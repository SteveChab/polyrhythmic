// polygrid model: pure logic, no DOM or audio. Spec: polygrid-spec.md.

import { getTuning, describePitch } from '../shared/tuning.js';

export const MAX_BEATS = 25;
export const ROWS = 3;
export const ROW_NAMES = ['Row 1', 'Row 2', 'Row 3'];

// ---------- Speed: the Rhythm <-> Tone slider ----------

export const SPEED_MIN_HZ = 0.25; // one cycle every 4 s
export const SPEED_MAX_HZ = 64;
export const SLIDER_MAX = 1000;
const SPAN = SPEED_MAX_HZ / SPEED_MIN_HZ; // 256

/** Slider position 0..1000 to cycles a second, logarithmic. */
export function sliderToHz(v) {
  return SPEED_MIN_HZ * SPAN ** (v / SLIDER_MAX);
}

/** Cycles a second to slider position 0..1000 (unrounded). */
export function hzToSlider(hz) {
  return (SLIDER_MAX * Math.log(hz / SPEED_MIN_HZ)) / Math.log(SPAN);
}

/** Where on the slider (0..100 %) a cycle rate falls. */
export function hzToPercent(hz) {
  return Math.max(0, Math.min(100, (hzToSlider(hz) / SLIDER_MAX) * 100));
}

export const TICKS = [
  { label: '15 /min', hz: 0.25 },
  { label: '1 Hz', hz: 1 },
  { label: '4 Hz', hz: 4 },
  { label: '16 Hz', hz: 16 },
  { label: '64 Hz', hz: 64 },
];

// ---------- Fusing ----------

export const FUSE_RATE = 20; // beats a second: a row becomes a tone
export const COLOR_START_RATE = 3; // cells start fading toward their note color
export const UNDERLINE_MAX_RATE = 10; // the playhead underline shows up to this rate
export const SWEEP_MAX_HZ = 3; // the shared sweep line shows up to this cycle rate
export const DRAW_MAX_COLUMNS = 300;

/** The cycle rate at which a row of n beats fuses into a tone. */
export const fuseHz = (n) => FUSE_RATE / n;

/** How far a row's cells have faded toward its color, 0..1, by beats a second. */
export function colorAmount(rate) {
  if (rate <= COLOR_START_RATE) return 0;
  if (rate >= FUSE_RATE) return 1;
  return Math.log(rate / COLOR_START_RATE) / Math.log(FUSE_RATE / COLOR_START_RATE);
}

// ---------- Rows and the grid ----------

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm2 = (a, b) => (a * b) / gcd(a, b);

/** Beat counts of the rows that are on, in row order. */
export const activeCounts = (beats) => beats.filter((n) => n > 0);

/** Where the rows realign: the least common multiple of the active row lengths (0 if none). */
export function gridColumns(beats) {
  const c = activeCounts(beats);
  return c.length ? c.reduce(lcm2, 1) : 0;
}

export function clampBeats(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX_BEATS, v));
}

// ---------- Snap to tuning ----------

/**
 * The cycle rate actually played. With snap on (and a tuning with steps), the speed is nudged so
 * the lowest active row lands exactly on a note; the other rows keep their exact ratios.
 */
export function effectiveHz(rawHz, beats, { snap = false, tuning = '12-edo' } = {}) {
  const { divisions } = getTuning(tuning);
  const counts = activeCounts(beats);
  if (!snap || !divisions || !counts.length) return rawHz;
  const low = Math.min(...counts);
  const step = Math.round(divisions * Math.log2((low * rawHz) / 440));
  return (440 * 2 ** (step / divisions)) / low;
}

/** Worst-case cents between a chord's rows and the tuning, with the lowest row on a note. null in Free. */
export function chordOffCents(rows, tuning) {
  const { divisions } = getTuning(tuning);
  if (!divisions) return null;
  const ns = activeCounts(rows);
  const step = 1200 / divisions;
  let worst = 0;
  for (let i = 1; i < ns.length; i++) {
    const c = 1200 * Math.log2(ns[i] / ns[0]);
    worst = Math.max(worst, Math.abs(c - Math.round(c / step) * step));
  }
  return Math.round(worst);
}

export function offText(cents, tuningLabel) {
  if (cents === null) return 'exact in Free (Hz)';
  if (cents === 0) return `in tune with ${tuningLabel}`;
  return `up to ${cents}¢ from ${tuningLabel}`;
}

// ---------- Presets ----------

export const GRID_PRESETS = [
  { id: 'halves-thirds', name: 'Halves and thirds', rows: [2, 3, 0], sounds: 'A perfect fifth' },
  { id: 'thirds-quarters', name: 'Thirds and quarters', rows: [3, 4, 0], sounds: 'A perfect fourth' },
  { id: 'web-12', name: 'The 12-column web grid', rows: [2, 3, 4], sounds: 'Octave and fifth' },
  { id: 'three-four-five', name: 'Three, four and five', rows: [3, 4, 5], sounds: 'A major chord' },
  { id: 'major-triad', name: 'Major triad', rows: [4, 5, 6], sounds: 'A major chord, root position' },
];

export const CHORD_PRESETS = [
  { id: 'minor', name: 'Minor triad', rows: [10, 12, 15], sounds: 'A minor chord' },
  { id: 'minor-1st', name: 'Minor, first inversion', rows: [12, 15, 20], sounds: 'A minor chord, first inversion' },
  { id: 'minor-2nd', name: 'Minor, second inversion', rows: [15, 20, 24], sounds: 'A minor chord, second inversion' },
  { id: 'maj7-no5', name: 'Major seventh, no fifth', rows: [8, 10, 15], sounds: 'A major seventh chord' },
  { id: 'min7-no5', name: 'Minor seventh, no fifth', rows: [5, 6, 9], sounds: 'A minor seventh chord' },
  { id: 'fourths', name: 'Stacked fourths', rows: [9, 12, 16], sounds: 'A quartal chord' },
  { id: 'augmented', name: 'Augmented', rows: [16, 20, 25], sounds: 'An augmented chord' },
  { id: 'major-1st', name: 'Major, first inversion', rows: [5, 6, 8], sounds: 'A major chord, first inversion' },
  { id: 'sus4', name: 'Suspended fourth', rows: [6, 8, 9], sounds: 'A sus4 chord' },
  { id: 'sus2', name: 'Suspended second', rows: [8, 9, 12], sounds: 'A sus2 chord' },
  { id: 'septimal-minor', name: 'Septimal minor', rows: [6, 7, 9], sounds: 'A minor chord with a low third' },
  { id: 'diminished', name: 'Diminished', rows: [5, 6, 7], sounds: 'A diminished chord' },
  { id: 'dom7-no5', name: 'Seventh, no fifth', rows: [4, 5, 7], sounds: 'A dominant seventh with a low seventh' },
];

export const ALL_PRESETS = [...GRID_PRESETS, ...CHORD_PRESETS];
export const presetById = (id) => ALL_PRESETS.find((p) => p.id === id) ?? null;
export const isChord = (p) => CHORD_PRESETS.includes(p);
export const ratioText = (rows) => activeCounts(rows).join(' : ');

/** The preset menu's two groups, chords sorted closest to the tuning first. */
export function presetGroups(tuning) {
  const { label, divisions } = getTuning(tuning);
  const grids = GRID_PRESETS.map((p) => ({
    preset: p,
    meta: `${ratioText(p.rows)} · ${gridColumns(p.rows)} columns · ${p.sounds}`,
  }));
  const chords = CHORD_PRESETS.map((p, i) => ({ p, i, off: chordOffCents(p.rows, tuning) }))
    .sort((a, b) => (a.off ?? 0) - (b.off ?? 0) || a.i - b.i)
    .map(({ p, off }) => ({ preset: p, meta: `${ratioText(p.rows)} · ${offText(off, label)}` }));
  return [
    { title: 'Grids', note: null, items: grids },
    {
      title: `Chords · ${label}`,
      note: divisions
        ? `Three-row chords that fit in 25 beats, closest to ${label} first.`
        : 'Three-row chords that fit in 25 beats. Free (Hz) plays every ratio exactly.',
      items: chords,
    },
  ];
}

// ---------- Readout text ----------

/** Hz with two decimals below 100, one above (as in the mockup). */
export const fmtHz = (f) => (f < 100 ? f.toFixed(2) : f.toFixed(1));

/** "30.0 cycles a minute" below 2 Hz, then "2.00 Hz", "16.0 Hz". */
export function speedLabel(hz) {
  if (hz < 2) {
    const perMin = hz * 60;
    return `${perMin.toFixed(perMin < 100 ? 1 : 0)} cycles a minute`;
  }
  return `${hz < 10 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

export function soundsText(preset, tuning) {
  if (!preset) return 'Custom';
  if (!isChord(preset)) return preset.sounds;
  return `${preset.sounds} · ${offText(chordOffCents(preset.rows, tuning), getTuning(tuning).label)}`;
}

export function gridText(beats) {
  const c = activeCounts(beats);
  if (!c.length) return 'All rows are off.';
  if (c.length === 1) return `One row of ${c[0]}: a ${c[0]}-column grid.`;
  const L = gridColumns(beats);
  return `Rows realign every ${L} units: a ${L}-column grid.`;
}

export function gridShort(beats) {
  const L = gridColumns(beats);
  if (!L) return 'no grid';
  return `${L} columns${L > DRAW_MAX_COLUMNS ? ' · too fine to draw' : ''}`;
}

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function pageCaption(beats) {
  const c = activeCounts(beats);
  if (!c.length) return 'No rows are on';
  if (c.length === 1) return `${c[0]} columns`;
  return `${andList(c)} columns on one ${gridColumns(beats)}-column page`;
}

export function pageAria(beats) {
  const c = activeCounts(beats);
  return c.length ? `The rows drawn as page columns: ${andList(c)} columns` : 'No rows are on';
}

const MINUS = '−';
const signedCents = (c) => (c > 0 ? '+' : MINUS) + Math.abs(c) + '¢';

/**
 * One row's line in the Notes readout.
 * Slow: "1.50 beats a second · not a pitch yet". A tone: "523.25 Hz · C5" plus, in 19, 24 and
 * 31-EDO, "· step k of N · +3¢ off", and "· snapped" on the snapped row.
 */
export function noteLine(n, hz, { tuning, snapped = false } = {}) {
  const rate = n * hz;
  if (rate < FUSE_RATE) return { tone: false, lead: `${rate.toFixed(2)} beats a second`, rest: ' · not a pitch yet' };
  const d = describePitch(rate, tuning);
  let rest = ` · ${d.textWithOctave}`;
  if (d.stepText) {
    const off = Math.round(d.offTuning);
    rest += ` · ${d.stepText}${off ? ` · ${signedCents(off)} off` : ''}`;
  }
  if (snapped) rest += ' · snapped';
  return { tone: true, lead: `${fmtHz(rate)} Hz`, rest };
}

// ---------- Volume ----------

export const ROW_DB_MIN = -60;

/** Row or master volume as gain. The slider's floor is silent. */
export function rowGain(db, muted) {
  if (muted || db <= ROW_DB_MIN) return 0;
  return 10 ** (db / 20);
}

export function dbText(db) {
  return (db === 0 ? '0.0' : MINUS + Math.abs(db).toFixed(1)) + ' dB';
}

/** Master slider 0..100 to gain, on the same perceptual curve as brightness. */
export function masterGain(v) {
  if (v <= 0) return 0;
  return 10 ** ((60 * Math.log10(v / 100)) / 20);
}

// ---------- State ----------

export const DEFAULT_STATE = Object.freeze({
  beats: [3, 4, 0],
  db: [0, -3, -3],
  mute: [false, false, false],
  slider: Math.round(hzToSlider(0.5)),
  preset: 'thirds-quarters',
  tuning: '12-edo',
  snap: false,
  master: 80,
});

/** Merge saved state over the defaults, dropping anything malformed. */
export function restoreState(saved) {
  const s = structuredClone(DEFAULT_STATE);
  if (!saved || typeof saved !== 'object') return s;
  const arr3 = (a, ok) => Array.isArray(a) && a.length === ROWS && a.every(ok);
  if (arr3(saved.beats, (n) => Number.isInteger(n) && n >= 0 && n <= MAX_BEATS)) s.beats = saved.beats;
  if (arr3(saved.db, (d) => typeof d === 'number' && d >= ROW_DB_MIN && d <= 0)) s.db = saved.db;
  if (arr3(saved.mute, (m) => typeof m === 'boolean')) s.mute = saved.mute;
  if (Number.isFinite(saved.slider)) s.slider = Math.max(0, Math.min(SLIDER_MAX, saved.slider));
  if (saved.preset === null || presetById(saved.preset)) s.preset = saved.preset;
  try { getTuning(saved.tuning); s.tuning = saved.tuning; } catch { /* keep default */ }
  if (typeof saved.snap === 'boolean') s.snap = saved.snap;
  if (Number.isFinite(saved.master)) s.master = Math.max(0, Math.min(100, saved.master));
  return s;
}
