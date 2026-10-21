// polytoggle song model: pure logic, no DOM or audio. Spec: polytoggle-file-format.md (version 1)
// and polytoggle-spec.md. Every edit helper takes a song and returns a new one (or null when the
// edit is blocked), so an undo step is just a kept snapshot.

import { TUNINGS, getTuning, DEFAULT_TUNING } from '../shared/tuning.js';

export const FORMAT = 'polytoggle';
export const CURRENT_VERSION = 1;

export const MAX_LANES = 8;
export const SCENE_COUNT = 5;
export const MIN_BEATS = 1;
export const MAX_BEATS = 20;
export const BPM_MIN = 20;
export const BPM_MAX = 400;
export const DB_MIN = -40; // the sliders' floor; files may still hold values down to DB_FILE_MIN
export const DB_FILE_MIN = -60;
export const DB_MAX = 0;
export const ENVELOPE_MAX_MS = 5000;
export const DEFAULT_NAME = 'Untitled project';
export const DEFAULT_BPM = 120;
export const DEFAULT_MASTER_DB = -6;

/** Thrown for any refused song or blocked load. The message is shown to the user as is. */
export class SongError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SongError';
  }
}

// ---------- Instruments ----------

// noisePct is the spec's default noise table. cents (pitch from A4) and envelope are starting
// values for a new lane: the spec says every instrument has a default pitch but doesn't list them.
const env = (attackMs, decayMs, sustainPct, releaseMs) => ({ attackMs, decayMs, sustainPct, releaseMs });

export const INSTRUMENTS = Object.freeze([
  { id: 'sine', name: 'Sine', group: 'synth', noisePct: 0, cents: -900, envelope: env(5, 200, 80, 150) },
  { id: 'triangle', name: 'Triangle', group: 'synth', noisePct: 0, cents: -900, envelope: env(5, 200, 80, 150) },
  { id: 'square', name: 'Square', group: 'synth', noisePct: 0, cents: -900, envelope: env(5, 200, 70, 150) },
  { id: 'saw', name: 'Saw', group: 'synth', noisePct: 0, cents: -900, envelope: env(5, 200, 70, 150) },
  { id: 'saw-bass', name: 'Saw bass', group: 'synth', noisePct: 0, cents: -2900, envelope: env(5, 250, 60, 120) },
  { id: 'electric-piano', name: 'Electric piano', group: 'synth', noisePct: 8, cents: -900, envelope: env(2, 600, 20, 300) },
  { id: 'kick', name: 'Kick', group: 'drum', noisePct: 10, cents: -3300, envelope: env(2, 180, 0, 60) },
  { id: 'snare', name: 'Snare', group: 'drum', noisePct: 55, cents: -1400, envelope: env(1, 160, 0, 60) },
  { id: 'clap', name: 'Clap', group: 'drum', noisePct: 75, cents: 1400, envelope: env(1, 140, 0, 60) },
  { id: 'floor-tom', name: 'Floor tom', group: 'drum', noisePct: 20, cents: -1900, envelope: env(2, 520, 0, 180) },
  { id: 'closed-hat', name: 'Closed hat', group: 'drum', noisePct: 92, cents: 4800, envelope: env(1, 40, 0, 20) },
  { id: 'open-hat', name: 'Open hat', group: 'drum', noisePct: 88, cents: 4800, envelope: env(1, 300, 0, 150) },
  { id: 'ride', name: 'Ride', group: 'drum', noisePct: 60, cents: 3600, envelope: env(1, 1800, 0, 900) },
  { id: '808-kick', name: '808 kick', group: 'drum', noisePct: 0, cents: -3800, envelope: env(2, 1500, 0, 900) },
  { id: '808-cowbell', name: '808 cowbell', group: 'drum', noisePct: 30, cents: 1000, envelope: env(1, 250, 0, 80) },
]);

export const INSTRUMENT_IDS = Object.freeze(INSTRUMENTS.map((i) => i.id));
export const getInstrument = (id) => INSTRUMENTS.find((i) => i.id === id) ?? null;

// ---------- Small helpers ----------

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a * b) / gcd(a, b);
const clone = (x) => structuredClone(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isInt = (x) => Number.isInteger(x);
const inRange = (x, lo, hi) => isNum(x) && x >= lo && x <= hi;
const textLength = (s) => [...s].length;
const laneIndex = (song, id) => song.lanes.findIndex((l) => l.id === id);

/** Nearest step of an N-EDO tuning for a pitch in cents from A4. Free (no steps) returns it unchanged. */
export function snapCents(cents, tuningId) {
  const { divisions } = getTuning(tuningId);
  if (!divisions) return cents;
  return (Math.round((cents * divisions) / 1200) * 1200) / divisions;
}

/** Frequency of a pitch in cents from A4 = 440 Hz. */
export const centsToHz = (cents) => 440 * 2 ** (cents / 1200);

/** A short random id for a new lane, unique among `taken`. `rand` is injectable for tests. */
export function newLaneId(taken, rand = Math.random) {
  const used = new Set(taken);
  for (;;) {
    let id = '';
    for (let i = 0; i < 4; i++) id += Math.floor(rand() * 36).toString(36);
    if (!used.has(id)) return id;
  }
}

// ---------- Creating ----------

export function defaultLaneSettings(instrumentId) {
  const inst = getInstrument(instrumentId);
  if (!inst) throw new SongError(`Unknown instrument: ${instrumentId}`);
  return {
    beats: 4,
    volumeDb: 0,
    pan: 0,
    solo: false,
    mute: false,
    tuning: DEFAULT_TUNING,
    envelope: { ...inst.envelope },
    notes: [],
  };
}

export function createSong({ name = DEFAULT_NAME, bpm = DEFAULT_BPM, masterDb = DEFAULT_MASTER_DB } = {}) {
  return {
    format: FORMAT,
    version: CURRENT_VERSION,
    name,
    bpm,
    masterDb,
    lanes: [],
    scenes: Array.from({ length: SCENE_COUNT }, () => ({ polytoggle: 'polymeter', lanes: {} })),
  };
}

// ---------- Loading: parse, version check, migrate, validate ----------

/**
 * One pure function per step: MIGRATIONS[1] turns a version 1 document into version 2, and so on.
 * Empty until the format changes; each new entry comes with a fixture and a test.
 */
export const MIGRATIONS = {};

export function migrate(doc, target = CURRENT_VERSION) {
  let d = doc;
  while (d.version < target) {
    const step = MIGRATIONS[d.version];
    if (!step) throw new SongError(`No way to open a version ${d.version} song.`);
    d = step(d);
  }
  return d;
}

/**
 * Open a song from text (a file or browser storage) or an already parsed object. Throws SongError
 * with a plain message. Returns a clean song: only known fields are copied, nothing is repaired.
 */
export function loadSong(input) {
  let doc = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch {
      throw new SongError("This isn't a polytoggle song.");
    }
  }
  if (!isObj(doc) || doc.format !== FORMAT) throw new SongError("This isn't a polytoggle song.");
  if (!isInt(doc.version) || doc.version < 1) throw new SongError('This song has no valid version number.');
  if (doc.version > CURRENT_VERSION) {
    throw new SongError('This song was made with a newer version of polytoggle. Reload the page to update, then try again.');
  }
  return validateSong(migrate(doc));
}

/** Check a current-version document against every rule and return a clean copy. Throws SongError. */
export function validateSong(doc) {
  const bad = (msg) => {
    throw new SongError(msg);
  };
  if (!isObj(doc)) bad("This isn't a polytoggle song.");
  if (doc.format !== FORMAT) bad("This isn't a polytoggle song.");
  if (doc.version !== CURRENT_VERSION) bad(`Expected version ${CURRENT_VERSION}.`);

  if (typeof doc.name !== 'string' || textLength(doc.name) < 1 || textLength(doc.name) > 64) {
    bad('The song name must be 1 to 64 characters.');
  }
  if (!inRange(doc.bpm, BPM_MIN, BPM_MAX) || Math.abs(doc.bpm * 100 - Math.round(doc.bpm * 100)) > 1e-6) {
    bad(`BPM must be a number from ${BPM_MIN} to ${BPM_MAX}, with up to two decimals.`);
  }
  if (!inRange(doc.masterDb, DB_FILE_MIN, DB_MAX)) bad('Master volume must be from −60 to 0 dB.');

  if (!Array.isArray(doc.lanes) || doc.lanes.length > MAX_LANES) bad(`A song has 0 to ${MAX_LANES} lanes.`);
  const ids = new Set();
  const lanes = doc.lanes.map((l, i) => {
    if (!isObj(l)) bad(`Lane ${i + 1} isn't a lane.`);
    if (typeof l.id !== 'string' || l.id.length < 1 || l.id.length > 16) bad(`Lane ${i + 1} needs an id of 1 to 16 characters.`);
    if (ids.has(l.id)) bad(`Two lanes share the id "${l.id}".`);
    ids.add(l.id);
    if (!getInstrument(l.instrument)) bad(`Lane ${i + 1} has an unknown instrument.`);
    if (typeof l.name !== 'string' || textLength(l.name) < 1 || textLength(l.name) > 32) {
      bad(`Lane ${i + 1}'s name must be 1 to 32 characters.`);
    }
    return { id: l.id, instrument: l.instrument, name: l.name };
  });

  if (!Array.isArray(doc.scenes) || doc.scenes.length !== SCENE_COUNT) bad(`A song has exactly ${SCENE_COUNT} scenes.`);
  const scenes = doc.scenes.map((s, si) => {
    if (!isObj(s)) bad(`Scene ${si + 1} isn't a scene.`);
    if (s.polytoggle !== 'polymeter' && s.polytoggle !== 'polyrhythm') {
      bad(`Scene ${si + 1}: polytoggle must be "polymeter" or "polyrhythm".`);
    }
    if (!isObj(s.lanes)) bad(`Scene ${si + 1} has no lane settings.`);
    for (const key of Object.keys(s.lanes)) {
      if (!ids.has(key)) bad(`Scene ${si + 1} has settings for a lane that doesn't exist.`);
    }
    const out = {};
    for (const lane of lanes) {
      if (!isObj(s.lanes[lane.id])) bad(`Scene ${si + 1}, ${lane.name}: missing lane settings.`);
      out[lane.id] = validateLaneSettings(s.lanes[lane.id], `Scene ${si + 1}, ${lane.name}`);
    }
    return { polytoggle: s.polytoggle, lanes: out };
  });

  return { format: FORMAT, version: CURRENT_VERSION, name: doc.name, bpm: doc.bpm, masterDb: doc.masterDb, lanes, scenes };
}

function validateLaneSettings(s, where) {
  const bad = (msg) => {
    throw new SongError(`${where}: ${msg}`);
  };
  if (!isInt(s.beats) || s.beats < MIN_BEATS || s.beats > MAX_BEATS) bad(`beats must be a whole number from ${MIN_BEATS} to ${MAX_BEATS}.`);
  if (!inRange(s.volumeDb, DB_FILE_MIN, DB_MAX)) bad('volume must be from −60 to 0 dB.');
  if (!inRange(s.pan, -1, 1)) bad('pan must be from −1 to 1.');
  if (typeof s.solo !== 'boolean' || typeof s.mute !== 'boolean') bad('solo and mute must be true or false.');
  if (!TUNINGS.some((t) => t.id === s.tuning)) bad('unknown tuning.');
  const e = s.envelope;
  if (!isObj(e)) bad('missing envelope.');
  for (const k of ['attackMs', 'decayMs', 'releaseMs']) {
    if (!inRange(e[k], 0, ENVELOPE_MAX_MS)) bad(`envelope ${k} must be from 0 to ${ENVELOPE_MAX_MS}.`);
  }
  if (!inRange(e.sustainPct, 0, 100)) bad('envelope sustainPct must be from 0 to 100.');
  if (!Array.isArray(s.notes)) bad('notes must be a list.');

  let lastEnd = 0;
  const notes = s.notes.map((n, i) => {
    if (!isObj(n)) bad(`note ${i + 1} isn't a note.`);
    if (!isInt(n.beat) || n.beat < 0) bad(`note ${i + 1} needs a start beat of 0 or more.`);
    if (!isInt(n.length) || n.length < 1) bad(`note ${i + 1} needs a length of 1 or more beats.`);
    if (n.beat + n.length > s.beats) bad(`a note runs past beat ${s.beats}.`);
    if (!isNum(n.cents)) bad(`note ${i + 1} needs a pitch in cents.`);
    if (!inRange(n.noisePct, 0, 100)) bad(`note ${i + 1}: noise must be from 0 to 100.`);
    if (!inRange(n.volumeDb, DB_FILE_MIN, DB_MAX)) bad(`note ${i + 1}: volume must be from −60 to 0 dB.`);
    if (n.beat < lastEnd) bad(`notes overlap at beat ${n.beat + 1}.`);
    lastEnd = n.beat + n.length;
    return { beat: n.beat, length: n.length, cents: n.cents, noisePct: n.noisePct, volumeDb: n.volumeDb };
  });

  return {
    beats: s.beats,
    volumeDb: s.volumeDb,
    pan: s.pan,
    solo: s.solo,
    mute: s.mute,
    tuning: s.tuning,
    envelope: { attackMs: e.attackMs, decayMs: e.decayMs, sustainPct: e.sustainPct, releaseMs: e.releaseMs },
    notes,
  };
}

/** The song as a file or storage string. Same document either way. */
export const serializeSong = (song) => JSON.stringify(song, null, 2);

// ---------- Reading ----------

/** A scene is empty (dashed tab) when none of its lanes has a note. Worked out, never stored. */
export const sceneIsEmpty = (scene) => Object.values(scene.lanes).every((l) => l.notes.length === 0);

/**
 * Where the lanes of a scene realign, in beats. Polymeter: the least common multiple of the lane
 * lengths. Polyrhythm: the longest lane. 0 with no lanes.
 */
export function loopBeats(scene) {
  const counts = Object.values(scene.lanes).map((l) => l.beats);
  if (!counts.length) return 0;
  return scene.polytoggle === 'polyrhythm' ? Math.max(...counts) : counts.reduce(lcm, 1);
}

// Volume sliders run 0 to 100 on a curve: halfway is −10 dB, so the middle of a slider is a usable level.
export const posToDb = (p) => (p <= 0 ? DB_MIN : p >= 100 ? 0 : Math.round(DB_MIN * (1 - p / 100) ** 2 * 10) / 10);
export const dbToPos = (db) => Math.round(100 * (1 - Math.sqrt(Math.min(1, Math.max(0, db / DB_MIN)))));

/** Seconds for `beats` beats (eighth notes) at `bpm` (quarter notes a minute). */
export const beatsToSeconds = (beats, bpm) => (beats * 30) / bpm; // BPM counts quarter notes; a beat is an eighth note

export const noteAt = (laneSettings, beat) => laneSettings.notes.find((n) => beat >= n.beat && beat < n.beat + n.length) ?? null;

// ---------- Global edits ----------

export function setName(song, name) {
  const t = String(name).trim();
  if (textLength(t) < 1 || textLength(t) > 64) return null;
  return { ...clone(song), name: t };
}

export function setBpm(song, bpm) {
  if (!isNum(bpm)) return null;
  const v = Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)) * 100) / 100;
  return { ...clone(song), bpm: v };
}

export function setMasterDb(song, db) {
  if (!isNum(db)) return null;
  return { ...clone(song), masterDb: Math.min(DB_MAX, Math.max(DB_MIN, db)) };
}

// ---------- Lane edits (shared by every scene) ----------

/** Add an empty lane to every scene. null when the song already has 8. */
export function addLane(song, instrumentId, { id, name } = {}) {
  if (song.lanes.length >= MAX_LANES) return null;
  const inst = getInstrument(instrumentId);
  if (!inst) throw new SongError(`Unknown instrument: ${instrumentId}`);
  const s = clone(song);
  const laneId = id ?? newLaneId(s.lanes.map((l) => l.id));
  s.lanes.push({ id: laneId, instrument: inst.id, name: name ?? inst.name });
  for (const scene of s.scenes) scene.lanes[laneId] = defaultLaneSettings(inst.id);
  return s;
}

/** Delete a lane from every scene. */
export function removeLane(song, laneId) {
  if (laneIndex(song, laneId) < 0) return null;
  const s = clone(song);
  s.lanes = s.lanes.filter((l) => l.id !== laneId);
  for (const scene of s.scenes) delete scene.lanes[laneId];
  return s;
}

/** An identical lane directly below, in every scene. null when the song already has 8. */
export function duplicateLane(song, laneId, { id } = {}) {
  const i = laneIndex(song, laneId);
  if (i < 0 || song.lanes.length >= MAX_LANES) return null;
  const s = clone(song);
  const copyId = id ?? newLaneId(s.lanes.map((l) => l.id));
  s.lanes.splice(i + 1, 0, { ...s.lanes[i], id: copyId });
  for (const scene of s.scenes) scene.lanes[copyId] = clone(scene.lanes[laneId]);
  return s;
}

/** Rename a lane. An empty name goes back to the instrument's name; over 32 characters is refused. */
export function renameLane(song, laneId, name) {
  const i = laneIndex(song, laneId);
  const t = String(name).trim();
  if (i < 0 || textLength(t) > 32) return null;
  const s = clone(song);
  s.lanes[i].name = t || getInstrument(s.lanes[i].instrument).name;
  return s;
}

/** Move a lane to a new position in the display order. */
export function moveLane(song, laneId, toIndex) {
  const i = laneIndex(song, laneId);
  if (i < 0 || !isInt(toIndex) || toIndex < 0 || toIndex >= song.lanes.length) return null;
  const s = clone(song);
  const [lane] = s.lanes.splice(i, 1);
  s.lanes.splice(toIndex, 0, lane);
  return s;
}

// ---------- Scene edits ----------

export function setPolytoggle(song, sceneIndex, mode) {
  if (mode !== 'polymeter' && mode !== 'polyrhythm') return null;
  const s = clone(song);
  s.scenes[sceneIndex].polytoggle = mode;
  return s;
}

/** Overwrite scene `to` with a copy of scene `from`. (Asking before overwriting is the UI's job.) */
export function copyScene(song, from, to) {
  if (from === to) return null;
  const s = clone(song);
  s.scenes[to] = clone(s.scenes[from]);
  return s;
}

/** Reset scene `i` to empty: no notes, polymeter, and every lane back to its instrument's default settings. */
export function clearScene(song, i) {
  if (!isInt(i) || i < 0 || i >= SCENE_COUNT) return null;
  const s = clone(song);
  s.scenes[i] = { polytoggle: 'polymeter', lanes: {} };
  for (const lane of s.lanes) s.scenes[i].lanes[lane.id] = defaultLaneSettings(lane.instrument);
  return s;
}

/** The scene `copyScene` should duplicate scene `from` into: the next empty one after it, wrapping round; -1 if none. */
export function nextEmptyScene(song, from) {
  for (let k = 1; k < SCENE_COUNT; k++) {
    const j = (from + k) % SCENE_COUNT;
    if (sceneIsEmpty(song.scenes[j])) return j;
  }
  return -1;
}

/** Reorder scene tabs. */
export function moveScene(song, from, to) {
  if (from === to || to < 0 || to >= SCENE_COUNT) return null;
  const s = clone(song);
  const [scene] = s.scenes.splice(from, 1);
  s.scenes.splice(to, 0, scene);
  return s;
}

// ---------- Lane settings edits (one scene) ----------

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Change volume, pan, solo, mute or envelope fields of a lane in one scene. Values are clamped. */
export function setLaneSettings(song, sceneIndex, laneId, patch) {
  if (laneIndex(song, laneId) < 0) return null;
  const s = clone(song);
  const l = s.scenes[sceneIndex].lanes[laneId];
  if (isNum(patch.volumeDb)) l.volumeDb = clamp(patch.volumeDb, DB_MIN, DB_MAX);
  if (isNum(patch.pan)) l.pan = clamp(patch.pan, -1, 1);
  if (typeof patch.solo === 'boolean') l.solo = patch.solo;
  if (typeof patch.mute === 'boolean') l.mute = patch.mute;
  if (isObj(patch.envelope)) {
    for (const k of ['attackMs', 'decayMs', 'releaseMs']) {
      if (isNum(patch.envelope[k])) l.envelope[k] = clamp(patch.envelope[k], 0, ENVELOPE_MAX_MS);
    }
    if (isNum(patch.envelope.sustainPct)) l.envelope.sustainPct = clamp(patch.envelope.sustainPct, 0, 100);
  }
  return s;
}

/**
 * Set a lane's beat count in one scene. Notes that start past the new end are deleted; a note that
 * crosses it is shortened to fit.
 */
export function setBeats(song, sceneIndex, laneId, beats) {
  if (laneIndex(song, laneId) < 0 || !isInt(beats) || beats < MIN_BEATS || beats > MAX_BEATS) return null;
  const s = clone(song);
  const l = s.scenes[sceneIndex].lanes[laneId];
  l.beats = beats;
  l.notes = l.notes
    .filter((n) => n.beat < beats)
    .map((n) => ({ ...n, length: Math.min(n.length, beats - n.beat) }));
  return s;
}

/** How many notes (in every scene) a tuning change would move, for the confirmation. */
export function tuningMoveCount(song, laneId, tuningId) {
  let count = 0;
  for (const scene of song.scenes) {
    for (const n of scene.lanes[laneId]?.notes ?? []) {
      if (Math.abs(snapCents(n.cents, tuningId) - n.cents) > 1e-9) count++;
    }
  }
  return count;
}

/** Change a lane's tuning in every scene, moving its notes to the nearest step of the new tuning. */
export function setTuning(song, laneId, tuningId) {
  if (laneIndex(song, laneId) < 0) return null;
  getTuning(tuningId);
  const s = clone(song);
  for (const scene of s.scenes) {
    const l = scene.lanes[laneId];
    l.tuning = tuningId;
    for (const n of l.notes) n.cents = snapCents(n.cents, tuningId);
  }
  return s;
}

// ---------- Note edits (one scene) ----------

const sortNotes = (notes) => notes.sort((a, b) => a.beat - b.beat);

/** True when beats [beat, beat + length) are free in the lane, ignoring the note at `ignoreBeat`. */
function isFree(l, beat, length, ignoreBeat = null) {
  if (beat < 0 || length < 1 || beat + length > l.beats) return false;
  return l.notes.every((n) => n.beat === ignoreBeat || n.beat + n.length <= beat || n.beat >= beat + length);
}

/** A new note at an instrument's default pitch, noise and a quiet-free volume. null if the beat is taken. */
export function addNote(song, sceneIndex, laneId, beat, overrides = {}) {
  const i = laneIndex(song, laneId);
  if (i < 0) return null;
  const s = clone(song);
  const l = s.scenes[sceneIndex].lanes[laneId];
  const inst = getInstrument(s.lanes[i].instrument);
  const note = {
    beat,
    length: 1,
    cents: snapCents(inst.cents, l.tuning),
    noisePct: inst.noisePct,
    volumeDb: 0,
    ...overrides,
  };
  if (!isInt(beat) || !isInt(note.length) || !isFree(l, beat, note.length)) return null;
  l.notes.push(note);
  sortNotes(l.notes);
  return s;
}

export function removeNote(song, sceneIndex, laneId, beat) {
  if (laneIndex(song, laneId) < 0) return null;
  const s = clone(song);
  const l = s.scenes[sceneIndex].lanes[laneId];
  const n = l.notes.length;
  l.notes = l.notes.filter((x) => x.beat !== beat);
  return l.notes.length === n ? null : s;
}

/** Change pitch, noise or volume of the note starting at `beat`. Values are clamped. */
export function setNote(song, sceneIndex, laneId, beat, patch) {
  if (laneIndex(song, laneId) < 0) return null;
  const s = clone(song);
  const n = s.scenes[sceneIndex].lanes[laneId].notes.find((x) => x.beat === beat);
  if (!n) return null;
  if (isNum(patch.cents)) n.cents = patch.cents;
  if (isNum(patch.noisePct)) n.noisePct = clamp(patch.noisePct, 0, 100);
  if (isNum(patch.volumeDb)) n.volumeDb = clamp(patch.volumeDb, DB_MIN, DB_MAX);
  return s;
}

/** Resize the note starting at `beat`: at least 1, and stopped by the lane's end or the next note. */
export function resizeNote(song, sceneIndex, laneId, beat, length) {
  if (laneIndex(song, laneId) < 0 || !isInt(length)) return null;
  const s = clone(song);
  const l = s.scenes[sceneIndex].lanes[laneId];
  const n = l.notes.find((x) => x.beat === beat);
  if (!n) return null;
  const next = l.notes.find((x) => x.beat > beat);
  const room = (next ? next.beat : l.beats) - beat;
  n.length = clamp(length, 1, room);
  return s;
}

/**
 * Move (or, with `copy`, duplicate) the note starting at `beat` to `toBeat` in `toLaneId`, in the
 * same scene. The length is capped at the destination lane's end. null when the beats are taken.
 * The pitch is kept as is.
 */
export function moveNote(song, sceneIndex, laneId, beat, toLaneId, toBeat, { copy = false } = {}) {
  if (laneIndex(song, laneId) < 0 || laneIndex(song, toLaneId) < 0 || !isInt(toBeat)) return null;
  const s = clone(song);
  const from = s.scenes[sceneIndex].lanes[laneId];
  const to = s.scenes[sceneIndex].lanes[toLaneId];
  const n = from.notes.find((x) => x.beat === beat);
  if (!n) return null;
  const length = Math.min(n.length, to.beats - toBeat);
  const ignore = !copy && laneId === toLaneId ? beat : null;
  if (isFree(to, toBeat, length, ignore)) {
    const moved = { ...n, beat: toBeat, length };
    if (!copy) from.notes = from.notes.filter((x) => x !== n);
    to.notes.push(moved);
    sortNotes(to.notes);
    return s;
  }
  if (copy) return null;
  // Dropped on one other note: swap. The dropped note takes the spot and the old note goes to where the dropped one came from.
  const hit = to.notes.filter((x) => x !== n && x.beat < toBeat + length && toBeat < x.beat + x.length);
  if (hit.length !== 1) return null;
  const other = hit[0];
  from.notes = from.notes.filter((x) => x !== n);
  to.notes = to.notes.filter((x) => x !== other);
  if (from === to) from.notes = to.notes;
  if (!isFree(to, toBeat, length)) return null;
  to.notes.push({ ...n, beat: toBeat, length });
  sortNotes(to.notes);
  const back = Math.min(other.length, from.beats - beat);
  if (!isFree(from, beat, back)) return null;
  from.notes.push({ ...other, beat, length: back });
  sortNotes(from.notes);
  return s;
}

/** The first free beat after the note starting at `beat` that fits a copy of it, or -1. */
export function nextFreeBeat(song, sceneIndex, laneId, beat) {
  const l = song.scenes[sceneIndex].lanes[laneId];
  const n = l.notes.find((x) => x.beat === beat);
  if (!n) return -1;
  for (let b = beat + 1; b + n.length <= l.beats; b++) if (isFree(l, b, n.length)) return b;
  return -1;
}
