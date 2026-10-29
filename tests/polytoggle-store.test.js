import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as song from '../toggle/song.js';
import * as st from '../toggle/store.js';
import { createHistory } from '../shared/history.js';

const fakeStorage = (opts = {}) => {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (opts.full) throw new Error('quota');
      m.set(k, v);
    },
  };
};
const withKick = () => song.addNote(song.addLane(song.createSong(), 'kick', { id: 'k' }), 0, 'k', 0);

test('autosave round trips the working song and its saved id', () => {
  const s = fakeStorage();
  const sg = withKick();
  assert.equal(st.loadWorking(s), null);
  assert.ok(st.saveWorking(s, sg, 'abc'));
  assert.deepEqual(st.loadWorking(s), { songId: 'abc', song: sg });
  assert.ok(st.saveWorking(s, sg, null));
  assert.equal(st.loadWorking(s).songId, null);
});

test('a corrupted or newer working song is ignored, not half-opened', () => {
  const s = fakeStorage();
  s.setItem(st.KEYS.working, '{nope');
  assert.equal(st.loadWorking(s), null);
  s.setItem(st.KEYS.working, JSON.stringify({ songId: null, song: { ...withKick(), version: 9 } }));
  assert.equal(st.loadWorking(s), null);
});

test('storage that refuses writes is reported, not thrown', () => {
  const s = fakeStorage({ full: true });
  assert.equal(st.saveWorking(s, withKick(), null), false);
  assert.equal(st.saveSong(s, withKick()), null);
});

test('Save writes the song and puts it first in Recent; autosave never touches Recent', () => {
  const s = fakeStorage();
  st.saveWorking(s, withKick(), null);
  assert.deepEqual(st.listRecent(s), []);
  const a = st.saveSong(s, song.setName(withKick(), 'First'), null, new Date('2026-10-20T10:00:00Z'));
  const b = st.saveSong(s, song.setName(withKick(), 'Second'), null, new Date('2026-10-20T11:00:00Z'));
  assert.deepEqual(st.listRecent(s).map((r) => r.name), ['Second', 'First']);
  st.saveSong(s, song.setName(withKick(), 'First again'), a, new Date('2026-10-20T12:00:00Z'));
  const r = st.listRecent(s);
  assert.deepEqual(r.map((x) => x.name), ['First again', 'Second']);
  assert.equal(r[0].savedAt, '2026-10-20T12:00:00.000Z');
  assert.equal(st.openSong(s, b).name, 'Second');
});

test('Recent keeps the 10 most recent', () => {
  const s = fakeStorage();
  for (let i = 0; i < 12; i++) st.saveSong(s, song.setName(song.createSong(), `Song ${i}`), null, new Date(2026, 9, 1, i));
  const r = st.listRecent(s);
  assert.equal(r.length, 10);
  assert.equal(r[0].name, 'Song 11');
  assert.equal(r[9].name, 'Song 2');
});

test('opening a song that is gone or damaged gives a plain message', () => {
  const s = fakeStorage();
  assert.throws(() => st.openSong(s, 'zzz'), /no longer saved/);
  s.setItem(st.KEYS.song('bad'), '{"format":"polytoggle","version":1}');
  assert.throws(() => st.openSong(s, 'bad'), song.SongError);
  s.setItem(st.KEYS.recent, 'junk');
  assert.deepEqual(st.listRecent(s), []);
});

test('unsaved changes: compared with the last Save', () => {
  const s = fakeStorage();
  const blank = (sg) => sg.lanes.length === 0;
  assert.equal(st.hasUnsavedChanges(s, song.createSong(), null, blank), false);
  const sg = withKick();
  assert.equal(st.hasUnsavedChanges(s, sg, null, blank), true);
  const id = st.saveSong(s, sg);
  assert.equal(st.hasUnsavedChanges(s, sg, id, blank), false);
  assert.equal(st.hasUnsavedChanges(s, song.addNote(sg, 0, 'k', 2), id, blank), true);
});

test('file names', () => {
  assert.equal(st.fileNameFor(song.setName(song.createSong(), 'My Song!')), 'my-song.polytoggle');
  assert.equal(st.fileNameFor(song.setName(song.createSong(), '???')), 'song.polytoggle');
  assert.equal(st.fileNameFor(song.createSong()), 'untitled-project.polytoggle');
});

test('history: undo and redo walk snapshots; a new edit drops the redo branch', () => {
  const a = song.createSong();
  const b = song.setBpm(a, 100);
  const c = song.setBpm(a, 90);
  const h = createHistory(a, 0);
  assert.equal(h.canUndo, false);
  h.push(b, 1);
  h.push(c, 2);
  assert.equal(h.song, c);
  assert.deepEqual(h.undo(), { song: b, scene: 2 }); // undoing an edit made in scene 3 goes there
  assert.deepEqual(h.undo(), { song: a, scene: 1 });
  assert.equal(h.undo(), null);
  assert.deepEqual(h.redo(), { song: b, scene: 1 });
  h.push(song.setBpm(a, 80), 0);
  assert.equal(h.canRedo, false);
  assert.equal(h.size, 2);
});

test('history: same-key edits merge until sealed; pushing the same song is a no-op', () => {
  const a = song.createSong();
  const h = createHistory(a);
  h.push(song.setBpm(a, 101), 0, 'bpm');
  h.push(song.setBpm(a, 102), 0, 'bpm');
  h.push(song.setBpm(a, 103), 0, 'bpm');
  assert.equal(h.size, 1);
  assert.equal(h.song.bpm, 103);
  h.seal();
  h.push(song.setBpm(a, 104), 0, 'bpm');
  assert.equal(h.size, 2);
  h.push(h.song, 0);
  assert.equal(h.size, 2);
  h.undo();
  h.push(song.setBpm(a, 50), 0, 'bpm'); // after undo, never merges into the older step
  assert.equal(h.size, 2);
  assert.equal(h.undo().song.bpm, 103);
});

test('history keeps 200 steps', () => {
  const h = createHistory(song.createSong());
  for (let i = 0; i < 250; i++) h.push(song.setBpm(song.createSong(), 20 + i), 0);
  assert.equal(h.size, 200);
  let n = 0;
  while (h.undo()) n++;
  assert.equal(n, 200);
});
