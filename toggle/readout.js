// polytoggle readouts and pitch editing helpers: pure text and number work for the screen.
// Pitch is stored as cents from A4 = 440 Hz (see polytoggle-file-format.md).

import { getTuning, name12, NOTE_NAMES, formatCents } from '../shared/tuning.js';
import { loopBeats, beatsToSeconds, snapCents, centsToHz } from './song.js';

/** m:ss, then h:mm:ss from an hour up, with as many hour digits as needed. */
export function formatDuration(seconds) {
  const total = Math.round(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${Math.floor(total / 60)}:${two(s)}`;
}

/** The loop-length readout in the top bar. */
export function loopReadout(scene, bpm) {
  const n = loopBeats(scene);
  if (!n) return 'add a lane to start';
  const beats = `${n.toLocaleString('en-US')} ${n === 1 ? 'beat' : 'beats'}`;
  const time = formatDuration(beatsToSeconds(n, bpm));
  return scene.polytoggle === 'polyrhythm' ? `all lanes loop every ${beats} · ${time}` : `lanes realign every ${beats} · ${time}`;
}

/** The phone's short loop readout above the lane headers: "realign 120 · 0:30" or "loop 8 · 0:02". */
export function loopShort(scene, bpm) {
  const n = loopBeats(scene);
  if (!n) return '';
  return `${scene.polytoggle === 'polyrhythm' ? 'loop' : 'realign'} ${n.toLocaleString('en-US')} · ${formatDuration(beatsToSeconds(n, bpm))}`;
}

// ---------- Naming a pitch ----------

/** "E2" for the nearest 12-EDO note (what a note's label shows). */
export function shortName(cents) {
  const n = name12(centsToHz(cents));
  return `${n.name}${n.octave}`;
}

/** "F#4 +5¢" or "A4": nearest 12-EDO note plus cents (octave included). */
export function fullName(cents) {
  return name12(centsToHz(cents)).textWithOctave;
}

/** {name:'F#', octave:4, offset:+5} split of a pitch, for the Pitch and Octave fields. */
export function splitPitch(cents) {
  const n = name12(centsToHz(cents));
  return { name: n.name, octave: n.octave, offset: Math.round(n.cents), label: n.text };
}

/** Cents from A4 for a note name, octave and an optional offset in cents. null if the name is wrong. */
export function centsFromName(name, octave, offset = 0) {
  const pc = NOTE_NAMES.indexOf(name.toUpperCase().replace('♯', '#'));
  if (pc < 0 || !Number.isFinite(octave)) return null;
  const midi = 12 * (Math.round(octave) + 1) + pc;
  return (midi - 69) * 100 + offset;
}

/** Read "F#", "f# +5", "Bb" or "A −12¢" (no octave). Flats are respelled as sharps. */
export function parsePitchText(text) {
  const m = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(?:([+\-−])\s*(\d+(?:\.\d+)?)\s*¢?)?\s*$/.exec(text);
  if (!m) return null;
  let pc = NOTE_NAMES.indexOf(m[1].toUpperCase());
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  pc = (pc + 12) % 12;
  const offset = m[3] ? (m[3] === '+' ? 1 : -1) * Number(m[4]) : 0;
  return { name: NOTE_NAMES[pc], offset };
}

/** Frequency in Hz to cents from A4, snapped to the lane's tuning (Free keeps it exact). */
export function hzToCents(hz, tuningId) {
  return snapCents(1200 * Math.log2(hz / 440), tuningId);
}

/** One step up (+1) or down (-1) in the lane's tuning. Free (Hz) moves 1 cent. */
export function stepPitch(cents, tuningId, dir) {
  const { divisions } = getTuning(tuningId);
  if (!divisions) return cents + dir;
  const pos = (cents * divisions) / 1200;
  const nearest = Math.round(pos);
  const onGrid = Math.abs(pos - nearest) < 1e-6;
  const k = onGrid ? nearest + dir : dir > 0 ? Math.ceil(pos) : Math.floor(pos);
  return (k * 1200) / divisions;
}

/** The step text in every EDO but 12, e.g. "step 7 of 19"; '' otherwise. */
export function stepText(cents, tuningId) {
  const { divisions } = getTuning(tuningId);
  if (!divisions || divisions === 12) return '';
  const k = Math.round((cents * divisions) / 1200);
  return `step ${((k % divisions) + divisions) % divisions} of ${divisions}`;
}

export { formatCents };
