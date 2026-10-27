// tuning.js: the shared tuning list and note naming. Pure: no DOM, no audio.
// Spec: site-spec.md, "Shared tuning options". Pitch is always anchored at A4 = 440 Hz.

export const A4 = 440;

export const TUNINGS = Object.freeze([
  { id: '5-edo', label: '5-EDO', divisions: 5 },
  { id: '7-edo', label: '7-EDO', divisions: 7 },
  { id: '9-edo', label: '9-EDO', divisions: 9 },
  { id: '12-edo', label: '12-EDO', divisions: 12 },
  { id: '19-edo', label: '19-EDO', divisions: 19 },
  { id: '24-edo', label: '24-EDO', divisions: 24 },
  { id: '31-edo', label: '31-EDO', divisions: 31 },
  { id: 'free', label: 'Free (Hz)', divisions: null },
]);

export const DEFAULT_TUNING = '12-edo';

export const NOTE_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

const MINUS = '−';
const mod = (n, m) => ((n % m) + m) % m;

export function getTuning(id) {
  const t = TUNINGS.find((x) => x.id === id);
  if (!t) throw new RangeError(`Unknown tuning: ${id}`);
  return t;
}

/** Cents above (or below) A4. */
export function centsFromA4(freq) {
  return 1200 * Math.log2(freq / A4);
}

/** Frequency of step `k` in an N-EDO tuning, counted from A4 = step 0 (k may be negative or past N). */
export function stepFrequency(k, divisions) {
  return A4 * 2 ** (k / divisions);
}

/** The nearest step (an integer, A4 = 0) to a frequency in an N-EDO tuning. */
export function nearestStep(freq, divisions) {
  return Math.round((centsFromA4(freq) * divisions) / 1200);
}

/** Snap a frequency to the chosen tuning. Free (Hz) returns it unchanged. */
export function snap(freq, tuningId) {
  const { divisions } = getTuning(tuningId);
  if (!divisions) return freq;
  return stepFrequency(nearestStep(freq, divisions), divisions);
}

/** Cents a frequency sits from the nearest note of the tuning (0 in Free). Signed: + is sharp. */
export function centsOffTuning(freq, tuningId) {
  const { divisions } = getTuning(tuningId);
  if (!divisions) return 0;
  return centsFromA4(freq) - (nearestStep(freq, divisions) * 1200) / divisions;
}

/** Format cents as "+5¢" or "−12¢" with the real minus sign; whole cents. */
export function formatCents(cents) {
  const c = Math.round(cents);
  if (c === 0) return '0¢';
  return (c > 0 ? '+' : MINUS) + Math.abs(c) + '¢';
}

/**
 * Name a frequency by the nearest 12-EDO note plus cents, e.g. "F# +5¢".
 * @returns {{name: string, octave: number, cents: number, text: string, textWithOctave: string}}
 */
export function name12(freq) {
  const exact = centsFromA4(freq) / 100; // semitones from A4
  // A tie (exactly 50¢) names the lower note: "A +50¢", not "A# −50¢".
  const semis = Math.round(exact - 1e-9);
  const midi = 69 + semis;
  const name = NOTE_NAMES[mod(midi, 12)];
  const octave = Math.floor(midi / 12) - 1;
  const cents = (exact - semis) * 100;
  const rounded = Math.round(cents);
  const suffix = rounded === 0 ? '' : ' ' + formatCents(cents);
  return { name, octave, cents, text: name + suffix, textWithOctave: name + octave + suffix };
}

/**
 * Describe a pitch in a tuning, for readouts and labels.
 * In 12-EDO: "E2". In every other EDO (5, 7, 9, 19, 24, 31): the nearest 12-EDO name plus cents, and "step k of N"
 * (k counted from A4 = step 0, folded into 0..N-1 within the octave). In Free (Hz): the
 * frequency in Hz, with the nearest name plus cents as a second line.
 */
export function describePitch(freq, tuningId = DEFAULT_TUNING) {
  const { divisions } = getTuning(tuningId);
  const out = { freq, hz: formatHz(freq), ...name12(freq) };
  if (divisions && divisions !== 12) {
    const step = nearestStep(freq, divisions);
    out.step = mod(step, divisions);
    out.divisions = divisions;
    out.stepText = `step ${out.step} of ${divisions}`;
  }
  out.offTuning = centsOffTuning(freq, tuningId);
  return out;
}

/** "440 Hz", "27.5 Hz", "1,760 Hz": up to one decimal below 100 Hz, whole numbers above. */
export function formatHz(freq) {
  const digits = freq < 100 ? 1 : 0;
  const n = Number(freq.toFixed(digits));
  return n.toLocaleString('en-US', { maximumFractionDigits: digits }) + ' Hz';
}
