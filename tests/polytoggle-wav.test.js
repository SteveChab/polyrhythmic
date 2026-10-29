import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, peakNormalize, wavFileName, wavInfo, exportPlan, fadeOut, LEAD_IN_SECONDS, TAIL_SECONDS, MAX_EXPORT_SECONDS } from '../polytoggle/wav.js';
import { createSong, addLane, addNote, setBeats, loopBeats, beatsToSeconds } from '../polytoggle/song.js';
import { createSequencer } from '../polytoggle/sequencer.js';

test('a cycle of 30 s or more is one pass', () => {
  for (const c of [30, 40, 120]) assert.equal(exportPlan(c).loops, 1);
});

test('a short cycle repeats whole loops to at least 30 s', () => {
  assert.equal(exportPlan(7.5).loops, 4);
  assert.equal(exportPlan(15).loops, 2);
  assert.equal(exportPlan(22).loops, 2);
  for (const c of [0.5, 3, 7.5, 22, 29.9]) {
    const p = exportPlan(c);
    assert.ok(p.bodySeconds >= 30 && p.bodySeconds < 30 + c + 1e-9, `${c}s -> ${p.bodySeconds}s`);
    assert.ok(Math.abs(p.bodySeconds - p.loops * c) < 1e-9); // ends on the loop point
  }
});

test('lead-in and tail are added; the 10-minute cap cuts a single pass', () => {
  const p = exportPlan(15);
  assert.equal(p.totalSeconds, LEAD_IN_SECONDS + 30 + TAIL_SECONDS);
  assert.equal(p.cut, false);
  const long = exportPlan(900);
  assert.equal(long.bodySeconds, MAX_EXPORT_SECONDS);
  assert.equal(long.cut, true);
});

test('fadeOut ends in silence, leaves the start alone, and does not overshoot', () => {
  const rate = 1000;
  const ch = [new Float32Array(3000).fill(1), new Float32Array(3000).fill(-0.5)];
  fadeOut(ch, rate, 1);
  assert.equal(ch[0][0], 1);
  assert.equal(ch[0][1999], 1);
  assert.ok(Math.abs(ch[0][2999]) < 1e-6 && Math.abs(ch[1][2999]) < 1e-6);
  for (let i = 2000; i < 3000; i++) assert.ok(ch[0][i] <= ch[0][i - 1] + 1e-9, 'never rises');
  const short = [new Float32Array(100).fill(1)];
  fadeOut(short, rate, 1); // shorter than the fade: fades the whole thing
  assert.ok(Math.abs(short[0][99]) < 1e-6);
});

test('booking over several cycles repeats the scene exactly, so a repeated export loops cleanly', () => {
  let s = createSong({ bpm: 120 });
  s = addLane(s, 'kick', { id: 'k' });
  s = setBeats(s, 0, 'k', 4);
  s = addNote(s, 0, 'k', 0);
  s = addNote(s, 0, 'k', 2);
  const cycle = beatsToSeconds(loopBeats(s.scenes[0]), 120);
  const sq = createSequencer({ song: s, sceneIndex: 0 });
  sq.play(0);
  const times = sq.book(0, cycle * 3).map((e) => e.time);
  assert.equal(times.length, 6);
  times.slice(0, 2).forEach((t, i) => assert.ok(Math.abs(times[i + 2] - (t + cycle)) < 1e-9 && Math.abs(times[i + 4] - (t + 2 * cycle)) < 1e-9));
});

test('peakNormalize puts the loudest sample at -1 dBFS, even for a very quiet scene, and leaves silence alone', () => {
  const quiet = [Float32Array.of(0, 0.0005, -0.001), Float32Array.of(0.0002, 0, 0)];
  peakNormalize(quiet);
  assert.ok(Math.abs(Math.abs(quiet[0][2]) - 10 ** (-1 / 20)) < 1e-6);
  const loud = [Float32Array.of(2, -1)];
  peakNormalize(loud);
  assert.ok(Math.abs(loud[0][0] - 10 ** (-1 / 20)) < 1e-6);
  const silent = [new Float32Array(4)];
  assert.equal(peakNormalize(silent), 1);
});

test('file name: song, scene, mode, then the tempo last', () => {
  assert.equal(wavFileName('my-song.polytoggle', 2, 'polymeter', 110), 'my-song-scene-2-polymeter-110bpm.wav');
  assert.equal(wavFileName('x.polytoggle', 1, 'polyrhythm', 97.5), 'x-scene-1-polyrhythm-97.5bpm.wav');
});

test('encodeWav writes a valid LIST/INFO chunk after the audio', () => {
  const info = wavInfo({ songName: 'My Song', sceneNumber: 2, mode: 'polymeter', bpm: 110, cycleSeconds: 12, loops: 5, soloed: ['Kick'], date: new Date('2026-10-27T12:00:00Z') });
  const buf = encodeWav([Float32Array.of(0, 0.5), Float32Array.of(0, -0.5)], 44100, info);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(v.getUint32(4, true), buf.byteLength - 8);
  const dataBytes = v.getUint32(40, true);
  assert.equal(dataBytes, 8);
  let o = 44 + dataBytes;
  assert.equal(str(o, 4), 'LIST');
  assert.equal(o + 8 + v.getUint32(o + 4, true), buf.byteLength);
  assert.equal(str(o + 8, 4), 'INFO');
  o += 12;
  const got = {};
  while (o < buf.byteLength) {
    const len = v.getUint32(o + 4, true);
    got[str(o, 4)] = str(o + 8, len - 1);
    o += 8 + len + (len % 2);
    assert.equal(o % 2, 0);
  }
  assert.equal(got.INAM, 'My Song');
  assert.match(got.ICMT, /^scene 2 \| 110 BPM \| polymeter \| cycle 12\.0 s x 5 loops \| solo: Kick \| exported 2026-10-27 \| created with polyrhythmic\.design$/);
  assert.equal(got.ICRD, '2026-10-27');
  assert.equal(encodeWav([Float32Array.of(0)], 44100).byteLength, 46); // no info: the plain file as before
});
