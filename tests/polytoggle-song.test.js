import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as s from '../toggle/song.js';

const fixture = readFileSync(new URL('./fixtures/song-v1.polytoggle', import.meta.url), 'utf8');
const sample = () => JSON.parse(fixture);
const refuses = (doc, re) => assert.throws(() => s.loadSong(doc), (e) => e instanceof s.SongError && re.test(e.message));

// A song with a kick (4 beats) and a saw bass (3 beats), ids fixed for readable tests.
const base = () => {
  let song = s.createSong();
  song = s.addLane(song, 'kick', { id: 'k' });
  return s.addLane(song, 'saw-bass', { id: 'b' });
};

test('saved v1 sample always opens (backwards compatibility)', () => {
  const song = s.loadSong(fixture);
  assert.equal(song.name, 'Fixture v1');
  assert.equal(song.bpm, 113.13);
  assert.equal(song.lanes.length, 2);
  assert.equal(song.scenes[0].lanes.k7f2.notes.length, 2);
  assert.equal(song.scenes[0].lanes.b9x1.notes[0].cents, -2905.263157894737);
  assert.deepEqual(song, sample());
});

test('a new song is valid, named Untitled project, with 5 empty scenes', () => {
  const song = s.createSong();
  assert.equal(song.name, 'Untitled project');
  assert.equal(song.scenes.length, 5);
  assert.deepEqual(s.loadSong(JSON.stringify(song)), song);
  assert.ok(song.scenes.every(s.sceneIsEmpty));
});

test('round trip through serializeSong', () => {
  const song = s.addNote(base(), 0, 'k', 0);
  assert.deepEqual(s.loadSong(s.serializeSong(song)), song);
});

test('refuses non-songs and newer versions with the spec messages', () => {
  refuses('not json', /isn't a polytoggle song/);
  refuses('{"format":"other","version":1}', /isn't a polytoggle song/);
  refuses('[1,2]', /isn't a polytoggle song/);
  refuses({ ...sample(), version: 2 }, /newer version of polytoggle\. Reload the page/);
  refuses({ ...sample(), version: 0 }, /valid version/);
  refuses({ ...sample(), version: 1.5 }, /valid version/);
});

test('migrations run in order from the file version up', () => {
  const saved = { ...s.MIGRATIONS };
  try {
    // Pretend the app is at v3: a v1 doc passes through 1→2 then 2→3.
    const calls = [];
    s.MIGRATIONS[1] = (d) => (calls.push(1), { ...d, version: 2 });
    s.MIGRATIONS[2] = (d) => (calls.push(2), { ...d, version: 3 });
    const out = s.migrate(sample(), 3);
    assert.deepEqual(calls, [1, 2]);
    assert.equal(out.version, 3);
  } finally {
    for (const k of Object.keys(s.MIGRATIONS)) delete s.MIGRATIONS[k];
    Object.assign(s.MIGRATIONS, saved);
  }
});

test('names the first problem plainly', () => {
  let d = sample();
  d.scenes[1].lanes.k7f2.notes = [{ beat: 3, length: 2, cents: 0, noisePct: 0, volumeDb: 0 }];
  refuses(d, /^Scene 2, Kick: a note runs past beat 4\.$/);

  d = sample();
  d.name = '';
  refuses(d, /song name/);
  d = sample();
  d.name = 'x'.repeat(65);
  refuses(d, /song name/);
  d = sample();
  d.bpm = 19;
  refuses(d, /BPM/);
  d = sample();
  d.bpm = 120.123;
  refuses(d, /two decimals/);
  d = sample();
  d.masterDb = 1;
  refuses(d, /Master volume/);
});

test('validates lanes', () => {
  let d = sample();
  d.lanes[1].id = 'k7f2';
  refuses(d, /share the id/);
  d = sample();
  d.lanes[0].instrument = 'banjo';
  refuses(d, /unknown instrument/);
  d = sample();
  d.lanes[0].name = 'y'.repeat(33);
  refuses(d, /1 to 32/);
  d = sample();
  d.lanes = Array.from({ length: 9 }, (_, i) => ({ id: 'l' + i, instrument: 'sine', name: 'L' }));
  refuses(d, /0 to 8 lanes/);
});

test('validates scenes and lane settings', () => {
  let d = sample();
  d.scenes.pop();
  refuses(d, /exactly 5 scenes/);
  d = sample();
  d.scenes[0].polytoggle = true;
  refuses(d, /polymeter/);
  d = sample();
  delete d.scenes[3].lanes.b9x1;
  refuses(d, /Scene 4, Low saw: missing/);
  d = sample();
  d.scenes[3].lanes.ghost = d.scenes[3].lanes.k7f2;
  refuses(d, /Scene 4 has settings for a lane that doesn't exist/);
  const bad = (mutate, re) => {
    const x = sample();
    mutate(x.scenes[0].lanes.k7f2);
    refuses(x, re);
  };
  bad((l) => (l.beats = 0), /Scene 1, Kick: beats/);
  bad((l) => (l.beats = 21), /beats/);
  bad((l) => (l.beats = 2.5), /beats/);
  bad((l) => (l.volumeDb = 3), /volume/);
  bad((l) => (l.pan = 1.5), /pan/);
  bad((l) => (l.solo = 'yes'), /solo and mute/);
  bad((l) => (l.tuning = '17-edo'), /tuning/);
  bad((l) => (l.envelope.attackMs = 6000), /attackMs/);
  bad((l) => (l.envelope.sustainPct = 101), /sustainPct/);
  bad((l) => delete l.envelope, /envelope/);
});

test('validates notes', () => {
  const bad = (note, re) => {
    const x = sample();
    x.scenes[0].lanes.k7f2.notes = Array.isArray(note) ? note : [note];
    refuses(x, re);
  };
  const ok = { beat: 0, length: 1, cents: 0, noisePct: 0, volumeDb: 0 };
  bad({ ...ok, beat: -1 }, /start beat/);
  bad({ ...ok, beat: 0.5 }, /start beat/);
  bad({ ...ok, length: 0 }, /length/);
  bad({ ...ok, cents: 'A4' }, /pitch/);
  bad({ ...ok, noisePct: 101 }, /noise/);
  bad({ ...ok, volumeDb: -61 }, /volume/);
  bad([{ ...ok, length: 2 }, { ...ok, beat: 1 }], /overlap/);
  bad([{ ...ok, beat: 2 }, { ...ok, beat: 0 }], /overlap/); // unsorted
});

test('drops unknown fields, so nothing is smuggled in', () => {
  const d = sample();
  d.evil = '<script>';
  d.lanes[0].html = '<b>';
  d.scenes[0].extra = 1;
  d.scenes[0].lanes.k7f2.notes[0].extra = 1;
  d.scenes[0].lanes.k7f2.envelope.extra = 1;
  assert.deepEqual(s.loadSong(d), sample());
});

test('does not mutate the input or share structure with it', () => {
  const d = sample();
  const song = s.loadSong(d);
  song.scenes[0].lanes.k7f2.notes[0].cents = 1;
  assert.equal(d.scenes[0].lanes.k7f2.notes[0].cents, -3300);
});

test('instrument defaults match the spec noise table', () => {
  const noise = Object.fromEntries(s.INSTRUMENTS.map((i) => [i.id, i.noisePct]));
  assert.deepEqual(noise, {
    sine: 0, triangle: 0, square: 0, saw: 0, 'saw-bass': 0, '808-kick': 0, 'electric-piano': 8,
    kick: 10, 'open-hat': 88, 'closed-hat': 92, ride: 60, 'floor-tom': 20, snare: 55, clap: 75, '808-cowbell': 30,
  });
  assert.equal(s.INSTRUMENTS.length, 15);
});

test('lanes: add to every scene, cap at 8, delete, duplicate, rename, reorder', () => {
  let song = base();
  assert.ok(song.scenes.every((sc) => sc.lanes.k && sc.lanes.b));
  assert.equal(song.lanes[0].name, 'Kick');
  song = s.renameLane(song, 'k', '  Thump ');
  assert.equal(song.lanes[0].name, 'Thump');
  assert.equal(s.renameLane(song, 'k', 'x'.repeat(33)), null);
  assert.equal(s.renameLane(song, 'k', '   ').lanes[0].name, 'Kick');

  song = s.addNote(song, 2, 'k', 1);
  const dup = s.duplicateLane(song, 'k', { id: 'k2' });
  assert.deepEqual(dup.lanes.map((l) => l.id), ['k', 'k2', 'b']);
  assert.equal(dup.scenes[2].lanes.k2.notes.length, 1);
  dup.scenes[2].lanes.k2.notes[0].beat = 3;
  assert.equal(song.scenes[2].lanes.k.notes[0].beat, 1);

  assert.deepEqual(s.moveLane(song, 'b', 0).lanes.map((l) => l.id), ['b', 'k']);
  const removed = s.removeLane(song, 'k');
  assert.ok(removed.scenes.every((sc) => !('k' in sc.lanes)));
  assert.equal(s.removeLane(song, 'nope'), null);

  let full = s.createSong();
  for (let i = 0; i < 8; i++) full = s.addLane(full, 'sine');
  assert.equal(new Set(full.lanes.map((l) => l.id)).size, 8);
  assert.equal(s.addLane(full, 'sine'), null);
  assert.equal(s.duplicateLane(full, full.lanes[0].id), null);
  assert.doesNotThrow(() => s.loadSong(JSON.stringify(full)));
});

test('newLaneId avoids taken ids', () => {
  const seq = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  assert.equal(s.newLaneId(['0000'], () => seq[i++]), 'iiii');
});

test('add note: default pitch snapped to the lane tuning, blocked when taken or out of range', () => {
  let song = base();
  song = s.addNote(song, 0, 'k', 0);
  assert.deepEqual(song.scenes[0].lanes.k.notes[0], { beat: 0, length: 1, cents: -3300, noisePct: 10, volumeDb: 0 });
  assert.equal(s.addNote(song, 0, 'k', 0), null);
  assert.equal(s.addNote(song, 0, 'k', 4), null); // lane is 4 beats: beats 0-3
  assert.equal(s.addNote(song, 0, 'k', -1), null);
  const t = s.setTuning(song, 'b', '19-edo');
  const n = s.addNote(t, 0, 'b', 0).scenes[0].lanes.b.notes[0];
  assert.ok(Math.abs(n.cents * 19 / 1200 - Math.round(n.cents * 19 / 1200)) < 1e-9);
  assert.doesNotThrow(() => s.loadSong(JSON.stringify(s.addNote(t, 0, 'b', 0))));
});

test('notes stay sorted; remove, set, resize', () => {
  let song = base();
  song = s.addNote(song, 0, 'k', 2);
  song = s.addNote(song, 0, 'k', 0);
  assert.deepEqual(song.scenes[0].lanes.k.notes.map((n) => n.beat), [0, 2]);
  song = s.resizeNote(song, 0, 'k', 0, 9);
  assert.equal(song.scenes[0].lanes.k.notes[0].length, 2); // stopped by the note at beat 3
  song = s.resizeNote(song, 0, 'k', 2, 9);
  assert.equal(song.scenes[0].lanes.k.notes[1].length, 2); // stopped by the lane end
  song = s.resizeNote(song, 0, 'k', 2, 0);
  assert.equal(song.scenes[0].lanes.k.notes[1].length, 1);
  song = s.setNote(song, 0, 'k', 0, { noisePct: 500, volumeDb: -99, cents: -3200 });
  assert.deepEqual(song.scenes[0].lanes.k.notes[0], { beat: 0, length: 2, cents: -3200, noisePct: 100, volumeDb: -40 });
  song = s.removeNote(song, 0, 'k', 0);
  assert.deepEqual(song.scenes[0].lanes.k.notes.map((n) => n.beat), [2]);
  assert.equal(s.removeNote(song, 0, 'k', 0), null);
});

test('move and copy notes across beats and lanes', () => {
  let song = s.setBeats(base(), 0, 'b', 3); // bass lane: 3 beats
  song = s.addNote(song, 0, 'k', 0, { length: 2 });
  song = s.addNote(song, 0, 'b', 0);
  const moved = s.moveNote(song, 0, 'k', 0, 'k', 1); // overlaps its own old spot: allowed
  assert.deepEqual(moved.scenes[0].lanes.k.notes.map((n) => [n.beat, n.length]), [[1, 2]]);
  const across = s.moveNote(song, 0, 'k', 0, 'b', 1); // bass lane has 3 beats: length caps at 2
  assert.equal(across.scenes[0].lanes.k.notes.length, 0);
  assert.deepEqual(across.scenes[0].lanes.b.notes.map((n) => [n.beat, n.length]), [[0, 1], [1, 2]]);
  assert.equal(s.moveNote(song, 0, 'k', 0, 'b', 0, { copy: true }), null); // a copy never displaces a note
  assert.equal(s.moveNote(song, 0, 'k', 0, 'b', 3), null); // past the end
  const copy = s.moveNote(song, 0, 'k', 0, 'b', 1, { copy: true });
  assert.equal(copy.scenes[0].lanes.k.notes.length, 1);
  assert.equal(copy.scenes[0].lanes.b.notes.length, 2);
  assert.doesNotThrow(() => s.loadSong(JSON.stringify(copy)));
  assert.equal(s.nextFreeBeat(song, 0, 'k', 0), 2);
  assert.equal(s.nextFreeBeat(s.addNote(song, 0, 'k', 2), 0, 'k', 0), -1);
});

test('shrinking a lane deletes notes past the end and shortens crossing ones', () => {
  let song = base();
  song = s.addNote(song, 0, 'k', 0);
  song = s.addNote(song, 0, 'k', 2, { length: 2 });
  const shrunk = s.setBeats(song, 0, 'k', 3);
  assert.deepEqual(shrunk.scenes[0].lanes.k.notes.map((n) => [n.beat, n.length]), [[0, 1], [2, 1]]);
  const shorter = s.setBeats(song, 0, 'k', 2);
  assert.deepEqual(shorter.scenes[0].lanes.k.notes.map((n) => n.beat), [0]);
  assert.equal(shorter.scenes[1].lanes.k.beats, 4); // other scenes untouched
  assert.equal(s.setBeats(song, 0, 'k', 21), null);
  assert.equal(s.setBeats(song, 0, 'k', 0), null);
  assert.doesNotThrow(() => s.loadSong(JSON.stringify(shorter)));
});

test('changing tuning moves notes to the nearest step in every scene, and counts them first', () => {
  let song = base();
  song = s.addNote(song, 0, 'b', 0, { cents: -2900 });
  song = s.addNote(song, 3, 'b', 1, { cents: -2900 });
  assert.equal(s.tuningMoveCount(song, 'b', '19-edo'), 2);
  assert.equal(s.tuningMoveCount(song, 'b', '24-edo'), 0); // 12-EDO is a subset of 24-EDO
  assert.equal(s.tuningMoveCount(song, 'b', 'free'), 0);
  const t = s.setTuning(song, 'b', '19-edo');
  const step = 1200 / 19;
  for (const [sc, beat] of [[0, 0], [3, 1]]) {
    const n = t.scenes[sc].lanes.b.notes.find((x) => x.beat === beat);
    assert.ok(Math.abs(n.cents - Math.round(n.cents / step) * step) < 1e-9);
    assert.ok(Math.abs(n.cents + 2900) <= step / 2 + 1e-9);
  }
  assert.ok(t.scenes.every((sc) => sc.lanes.b.tuning === '19-edo'));
  const free = s.setTuning(t, 'b', 'free');
  assert.deepEqual(free.scenes[0].lanes.b.notes, t.scenes[0].lanes.b.notes);
  assert.throws(() => s.setTuning(song, 'b', 'nope'), RangeError);
});

test('scenes: empty is worked out, copy, reorder, polytoggle', () => {
  let song = base();
  assert.ok(s.sceneIsEmpty(song.scenes[0]));
  song = s.addNote(song, 1, 'k', 0);
  assert.ok(!s.sceneIsEmpty(song.scenes[1]));
  const copied = s.copyScene(song, 1, 4);
  assert.ok(!s.sceneIsEmpty(copied.scenes[4]));
  assert.notEqual(copied.scenes[4], copied.scenes[1]);
  assert.equal(s.copyScene(song, 1, 1), null);
  const moved = s.moveScene(song, 1, 0);
  assert.ok(!s.sceneIsEmpty(moved.scenes[0]));
  assert.ok(s.sceneIsEmpty(moved.scenes[1]));
  assert.equal(s.setPolytoggle(song, 2, 'polyrhythm').scenes[2].polytoggle, 'polyrhythm');
  assert.equal(s.setPolytoggle(song, 2, 'both'), null);
});

test('loop length: lcm in polymeter, longest in polyrhythm, and its time', () => {
  let song = base(); // kick 4, saw bass 4 by default
  song = s.setBeats(song, 0, 'b', 3);
  assert.equal(s.loopBeats(song.scenes[0]), 12);
  assert.equal(s.loopBeats(s.setPolytoggle(song, 0, 'polyrhythm').scenes[0]), 4);
  assert.equal(s.loopBeats(s.createSong().scenes[0]), 0);
  let big = s.createSong();
  for (const n of [16, 17, 19, 20, 11, 13, 9]) {
    big = s.addLane(big, 'sine');
    big = s.setBeats(big, 0, big.lanes.at(-1).id, Math.min(n, 20));
  }
  assert.equal(s.loopBeats(big.scenes[0]), 16 * 17 * 19 * 5 * 11 * 13 * 9);
  assert.equal(s.beatsToSeconds(120, 120), 30);
});

test('global edits clamp and refuse', () => {
  const song = s.createSong();
  assert.equal(s.setBpm(song, 1000).bpm, 400);
  assert.equal(s.setBpm(song, 5).bpm, 20);
  assert.equal(s.setBpm(song, 113.1337).bpm, 113.13);
  assert.equal(s.setBpm(song, NaN), null);
  assert.equal(s.setMasterDb(song, 6).masterDb, 0);
  assert.equal(s.setMasterDb(song, -100).masterDb, -40);
  assert.equal(s.setName(song, '  Hi ').name, 'Hi');
  assert.equal(s.setName(song, ''), null);
  const l = s.setLaneSettings(base(), 0, 'k', { volumeDb: 5, pan: -3, mute: true, envelope: { sustainPct: 150, attackMs: -1 } });
  assert.deepEqual(
    [l.scenes[0].lanes.k.volumeDb, l.scenes[0].lanes.k.pan, l.scenes[0].lanes.k.mute, l.scenes[0].lanes.k.envelope.sustainPct, l.scenes[0].lanes.k.envelope.attackMs],
    [0, -1, true, 100, 0],
  );
});

test('edits never mutate the song they start from', () => {
  const song = s.addNote(base(), 0, 'k', 0);
  const before = JSON.stringify(song);
  s.addNote(song, 0, 'k', 1);
  s.removeLane(song, 'k');
  s.setBeats(song, 0, 'k', 1);
  s.setTuning(song, 'k', '31-edo');
  s.moveNote(song, 0, 'k', 0, 'b', 1);
  s.copyScene(song, 0, 1);
  assert.equal(JSON.stringify(song), before);
});

test('cents and Hz', () => {
  assert.equal(s.centsToHz(0), 440);
  assert.ok(Math.abs(s.centsToHz(300) - 523.2511) < 1e-3);
  assert.ok(Math.abs(s.centsToHz(-3300) - 65.4064) < 1e-3);
  assert.equal(s.snapCents(123, 'free'), 123);
  assert.equal(s.snapCents(149, '12-edo'), 100);
});

test('volume curve: sliders run 0-100, halfway is -10 dB, and the ends are silent and 0 dB', () => {
  assert.equal(s.posToDb(0), s.DB_MIN);
  assert.equal(s.posToDb(100), 0);
  assert.equal(s.posToDb(50), -10);
  for (const p of [0, 10, 37, 50, 74, 100]) assert.equal(s.dbToPos(s.posToDb(p)), p);
  assert.equal(s.DB_MIN, -40);
});

test('a beat is an eighth note: the default is 120 BPM and a beat lasts 30 / BPM seconds', () => {
  assert.equal(s.DEFAULT_BPM, 120);
  assert.equal(s.beatsToSeconds(1, 120), 0.25);
});

test('dropping a note on another swaps them: the old note goes to where the dropped one came from', () => {
  let song = s.setBeats(base(), 0, 'b', 3);
  song = s.addNote(song, 0, 'k', 0, { length: 1 });
  song = s.addNote(song, 0, 'b', 1, { length: 1 });
  const swapped = s.moveNote(song, 0, 'k', 0, 'b', 1);
  const k = swapped.scenes[0].lanes.k.notes;
  const b = swapped.scenes[0].lanes.b.notes;
  assert.equal(k.length, 1);
  assert.equal(k[0].beat, 0);
  assert.equal(k[0].cents, song.scenes[0].lanes.b.notes[0].cents); // the old bass note is now in the kick lane
  assert.equal(b.length, 1);
  assert.equal(b[0].beat, 1);
  assert.equal(b[0].cents, song.scenes[0].lanes.k.notes[0].cents);
});

test('swapping inside one lane, and when a swap cannot fit', () => {
  let song = s.addNote(base(), 0, 'k', 0, { length: 1 });
  song = s.addNote(song, 0, 'k', 2, { length: 1 });
  const same = s.moveNote(song, 0, 'k', 0, 'k', 2);
  assert.deepEqual(same.scenes[0].lanes.k.notes.map((n) => n.beat), [0, 2]);
  assert.equal(same.scenes[0].lanes.k.notes[0].cents, song.scenes[0].lanes.k.notes[1].cents);
  // two notes under the drop: no swap
  let two = s.addNote(base(), 0, 'k', 0, { length: 2 });
  two = s.addNote(two, 0, 'k', 2, { length: 1 });
  two = s.addNote(two, 0, 'k', 3, { length: 1 });
  assert.equal(s.moveNote(two, 0, 'k', 0, 'k', 2), null);
  // the displaced note is shortened to fit where the dropped one came from
  let tight = s.setBeats(base(), 0, 'b', 4);
  tight = s.addNote(tight, 0, 'k', 3, { length: 1 });
  tight = s.addNote(tight, 0, 'b', 0, { length: 4 });
  const fit = s.moveNote(tight, 0, 'k', 3, 'b', 0);
  assert.equal(fit.scenes[0].lanes.k.notes[0].length, 1);
});

test('clear scene resets one scene to empty and keeps the lanes; duplicate goes to the next empty scene', () => {
  let song = s.addNote(base(), 0, 'k', 0);
  song = s.setPolytoggle(song, 0, 'polyrhythm');
  song = s.setLaneSettings(song, 0, 'k', { volumeDb: -10 });
  song = s.copyScene(song, 0, 1);
  assert.equal(s.nextEmptyScene(song, 0), 2);
  assert.equal(s.nextEmptyScene(song, 1), 2);
  const cleared = s.clearScene(song, 0);
  assert.ok(s.sceneIsEmpty(cleared.scenes[0]));
  assert.equal(cleared.scenes[0].polytoggle, 'polymeter');
  assert.equal(cleared.scenes[0].lanes.k.volumeDb, 0);
  assert.deepEqual(Object.keys(cleared.scenes[0].lanes), Object.keys(song.scenes[0].lanes));
  assert.equal(cleared.scenes[1].lanes.k.notes.length, 1); // other scenes untouched
  assert.doesNotThrow(() => s.loadSong(JSON.stringify(cleared)));
  assert.equal(s.clearScene(song, 9), null);
  let full = song;
  for (const i of [2, 3, 4]) full = s.copyScene(full, 0, i);
  assert.equal(s.nextEmptyScene(full, 0), -1);
});
