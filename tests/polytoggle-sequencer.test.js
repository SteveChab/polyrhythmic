import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as song from '../polytoggle/song.js';
import * as q from '../polytoggle/sequencer.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// 60 BPM (a beat is an eighth note, 30/bpm s): a global beat is 0.5 s. Kick on 4 beats (hits on 0 and 2), bass on 3 (hits on 0 and 1).
function make({ polytoggle = 'polymeter', bpm = 60 } = {}) {
  let s = song.createSong({ bpm });
  s = song.addLane(s, 'kick', { id: 'k' });
  s = song.addLane(s, 'saw-bass', { id: 'b' });
  s = song.setBeats(s, 0, 'b', 3);
  s = song.addNote(s, 0, 'k', 0);
  s = song.addNote(s, 0, 'k', 2);
  s = song.addNote(s, 0, 'b', 0);
  s = song.addNote(s, 0, 'b', 1, { length: 2 });
  return song.setPolytoggle(s, 0, polytoggle);
}
const times = (events, id) => events.filter((e) => e.laneId === id).map((e) => e.time);

test('polymeter: each lane steps once per global beat and loops on its own length', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  const ev = sq.book(0, 6); // 12 beats
  assert.deepEqual(times(ev, 'k'), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(times(ev, 'b'), [0, 0.5, 1.5, 2, 3, 3.5, 4.5, 5, ]);
  assert.deepEqual(ev.filter((e) => e.laneId === 'k').map((e) => [e.step, e.cycle]), [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]]);
});

test('polyrhythm: all lanes loop together; a 3-beat lane steps every 4/3 beats', () => {
  const sq = q.createSequencer({ song: make({ polytoggle: 'polyrhythm' }) });
  sq.play(0);
  const ev = sq.book(0, 4); // two loops of 4 beats
  assert.deepEqual(times(ev, 'k'), [0, 1, 2, 3]);
  const bass = times(ev, 'b');
  [0, 2 / 3, 2, 2 + 2 / 3].forEach((t, i) => near(bass[i], t));
  assert.equal(bass.length, 4);
  assert.deepEqual(ev.filter((e) => e.laneId === 'b').map((e) => e.step), [0, 1, 0, 1]);
  assert.deepEqual(q.laneTiming(sq.sceneAt(0).song.scenes[0], 'b'), { n: 3, span: 4, stepBeats: 4 / 3 });
});

test('note end time follows its length and the lane step', () => {
  let sq = q.createSequencer({ song: make() });
  sq.play(0);
  const poly = sq.book(0, 2).find((e) => e.laneId === 'b' && e.step === 1);
  near(poly.endTime - poly.time, 1); // 2 steps × 1 beat × 0.5 s
  sq = q.createSequencer({ song: make({ polytoggle: 'polyrhythm' }) });
  sq.play(0);
  const rh = sq.book(0, 2).find((e) => e.laneId === 'b' && e.step === 1);
  near(rh.endTime - rh.time, 2 * (4 / 3) * 0.5);
});

test('consecutive windows give every event exactly once, however they are cut', () => {
  for (const mode of ['polymeter', 'polyrhythm']) {
    const whole = (() => {
      const sq = q.createSequencer({ song: make({ polytoggle: mode }) });
      sq.play(0);
      return sq.book(0, 30);
    })();
    const sq = q.createSequencer({ song: make({ polytoggle: mode }) });
    sq.play(0);
    const pieces = [];
    let t = 0;
    let seed = 7;
    while (t < 30) {
      seed = (seed * 48271) % 2147483647;
      const w = 0.001 + (seed / 2147483647) * 0.13; // windows like the scheduler's ~100 ms
      pieces.push(...sq.book(t, Math.min(30, t + w)));
      t += w;
    }
    const key = (e) => `${e.laneId}@${e.time.toFixed(9)}`;
    assert.deepEqual(pieces.map(key).sort(), whole.map(key).sort(), mode);
  }
});

test('solo and mute', () => {
  const base = make();
  const heard = (s) => q.audibleLaneIds(s.scenes[0]);
  assert.deepEqual(heard(base), ['k', 'b']);
  assert.deepEqual(heard(song.setLaneSettings(base, 0, 'k', { mute: true })), ['b']);
  assert.deepEqual(heard(song.setLaneSettings(base, 0, 'k', { solo: true })), ['k']);
  assert.deepEqual(heard(song.setLaneSettings(song.setLaneSettings(base, 0, 'k', { solo: true, mute: true }), 0, 'b', { solo: true })), ['b']);
  const sq = q.createSequencer({ song: song.setLaneSettings(base, 0, 'b', { mute: true }) });
  sq.play(0);
  assert.ok(sq.book(0, 4).every((e) => e.laneId === 'k'));
});

test('does nothing until played, and nothing before the start', () => {
  const sq = q.createSequencer({ song: make() });
  assert.deepEqual(sq.book(0, 5), []);
  assert.equal(sq.playheads(0).length, 2); // paused at beat 1
  sq.play(10);
  assert.equal(sq.playheads(9), null);
  assert.deepEqual(sq.book(0, 10), []);
  assert.equal(sq.book(9, 11)[0].time, 10);
});

test('restart lands on the next global beat; every lane starts again from beat 1', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  const T = sq.restart(1.2); // beats fall every 0.5 s: next is 1.5
  assert.equal(T, 1.5);
  const ev = sq.book(0, 4);
  // Before 1.5: the old loop (bass at beat 3 would be the step 0 at 1.5, but restarts as step 0 anyway).
  assert.deepEqual(times(ev, 'k'), [0, 1, 1.5, 2.5, 3.5]);
  assert.deepEqual(ev.filter((e) => e.laneId === 'b' && e.time >= 1.5).map((e) => [e.time, e.step]), [[1.5, 0], [2, 1], [3, 0], [3.5, 1]]);
});

test('restart exactly on a beat lands now; a second restart before it replaces the first', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  assert.equal(sq.restart(1), 1);
  const a = sq.restart(1.1);
  assert.equal(a, 1.5);
  const b = sq.restart(1.2);
  assert.equal(b, 1.5);
  assert.equal(times(sq.book(1.4, 1.6), 'k').filter((t) => t === 1.5).length, 1);
});

test('a scene switch uses that scene on the next beat; playheads follow what is heard', () => {
  let s = make();
  s = song.addNote(s, 1, 'k', 1);
  s = song.setBeats(s, 1, 'k', 2); // scene 2: kick on 2 beats, hit on beat 2
  const sq = q.createSequencer({ song: s });
  sq.play(0);
  const T = sq.restart(0.6, { sceneIndex: 1 });
  assert.equal(T, 1);
  assert.equal(sq.sceneAt(0.9).sceneIndex, 0);
  assert.equal(sq.sceneAt(1).sceneIndex, 1);
  const ev = sq.book(0, 3);
  assert.deepEqual(ev.filter((e) => e.time >= 1).map((e) => [e.laneId, e.time]), [['k', 1.5], ['k', 2.5]]);
  assert.equal(sq.playheads(0.9)[0].laneId, 'k');
  assert.equal(sq.playheads(0.9)[1].laneId, 'b'); // old scene still drawn before T
  near(sq.playheads(1.25)[0].position, 0.5);
});

test('switching the polytoggle restarts on the next beat in the new mode', () => {
  const s = make();
  const sq = q.createSequencer({ song: s });
  sq.play(0);
  sq.restart(0.1, { song: song.setPolytoggle(s, 0, 'polyrhythm') });
  const ev = sq.book(0, 4);
  const bassAfter = times(ev, 'b').filter((t) => t >= 0.5);
  near(bassAfter[0], 0.5);
  near(bassAfter[1], 0.5 + 2 / 3); // 4/3 beats = 2/3 s per step
});

test('a note cut by a restart ends there', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  sq.restart(0.6); // lands at 1
  const long = sq.book(0, 1).find((e) => e.laneId === 'b' && e.step === 1);
  assert.equal(long.time, 0.5);
  assert.equal(long.endTime, 1); // would have run to 1.5
});

test('tempo change keeps the phase: no lost or doubled beat', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  sq.setSong(song.setBpm(make(), 30), 1.25); // 2.5 beats in; a beat is now 1 s
  // Kick hits on beats 0, 2, 4, 6: 0 s and 1 s at 60 BPM, then beat 4 at 1.25 + 1.5 × 1 s, beat 6 a second per beat later.
  assert.deepEqual(times(sq.book(0, 5), 'k'), [0, 1, 2.75, 4.75]);
  near(sq.phaseAt(1.25), 2.5);
  near(sq.phaseAt(2.25), 3.5);
});

test('editing notes while playing applies from the cursor on, not to the past', () => {
  const s = make();
  const sq = q.createSequencer({ song: s });
  sq.play(0);
  const before = sq.book(0, 2);
  const edited = song.removeNote(s, 0, 'k', 2);
  sq.setSong(edited, 2);
  const after = sq.book(2, 6);
  assert.deepEqual(times(before, 'k'), [0, 1]);
  assert.deepEqual(times(after, 'k'), [2, 4]); // the beat-3 hit (t = 3, 5) is gone
  assert.equal(sq.sceneAt(1).song.scenes[0].lanes.k.notes.length, 2); // history keeps the old song
});

test('a pending restart picks up later edits and tempo', () => {
  const s = make();
  const sq = q.createSequencer({ song: s });
  sq.play(0);
  sq.restart(0.1); // lands at 0.5
  sq.setSong(song.setBpm(s, 30), 0.2);
  const ev = sq.book(0, 4);
  assert.deepEqual(times(ev, 'k').filter((t) => t >= 0.5), [0.5, 2.5]);
});

test('pause remembers the beat; play carries on from it', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  sq.pause(1.25); // 2.5 beats in
  assert.equal(sq.playing, false);
  assert.deepEqual(sq.book(1.25, 5), []);
  near(sq.playheads(99)[0].position, 2.5); // kick, 4 beats
  sq.play(10);
  const ev = sq.book(10, 12);
  // Beat 3 has no kick note; beat 4 (step 0) lands 1.5 beats after resuming.
  near(ev.find((e) => e.laneId === 'k').time, 10.75);
  assert.equal(ev.find((e) => e.laneId === 'k').step, 0);
});

test('restart while paused goes back to beat 1 on play', () => {
  const sq = q.createSequencer({ song: make() });
  sq.play(0);
  sq.pause(1.25);
  sq.restart(2);
  sq.play(5);
  assert.equal(sq.book(5, 5.1)[0].time, 5);
});

test('playheads: polymeter wraps on each lane length; polyrhythm fills the longest lane', () => {
  let sq = q.createSequencer({ song: make() });
  sq.play(0);
  let [k, b] = sq.playheads(1.75); // 3.5 beats
  near(k.position, 3.5);
  assert.equal(k.step, 3);
  near(b.position, 0.5); // 3.5 mod 3
  assert.equal(b.step, 0);
  sq = q.createSequencer({ song: make({ polytoggle: 'polyrhythm' }) });
  sq.play(0);
  [k, b] = sq.playheads(1.75);
  near(k.position, 3.5);
  near(b.position, 2.625); // 3.5 of 4 beats × 3 steps
  assert.equal(b.step, 2);
  [k, b] = sq.playheads(2.25); // 4.5 beats: second loop
  near(k.position, 0.5);
  near(b.position, 0.375);
});

test('prune drops old history but keeps what is in effect', () => {
  const s = make();
  const sq = q.createSequencer({ song: s });
  sq.play(0);
  sq.setSong(song.setBpm(s, 100), 1);
  sq.setSong(song.setBpm(s, 90), 2);
  sq.prune(1.5);
  assert.equal(sq.sceneAt(1.6).sceneIndex, 0);
  assert.ok(sq.playheads(3));
  assert.ok(sq.book(3, 4).length > 0);
});

test('works with the real scheduler windows at BPM extremes', () => {
  for (const bpm of [20, 400]) {
    const sq = q.createSequencer({ song: make({ bpm }) });
    sq.play(0);
    const per = 30 / bpm;
    const ev = sq.book(0, per * 12);
    assert.equal(times(ev, 'k').length, 12 / 4 * 2);
    near(times(ev, 'k')[1], 2 * per);
  }
});
