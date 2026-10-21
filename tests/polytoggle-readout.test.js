import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../polytoggle/readout.js';
import * as song from '../polytoggle/song.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('durations: m:ss, then h:mm:ss with as many hour digits as needed', () => {
  assert.equal(r.formatDuration(0), '0:00');
  assert.equal(r.formatDuration(59.4), '0:59');
  assert.equal(r.formatDuration(61), '1:01');
  assert.equal(r.formatDuration(3599.6), '1:00:00');
  assert.equal(r.formatDuration(3661), '1:01:01');
  assert.equal(r.formatDuration(116_396_280), '32332:18:00');
});

test('loop readout: polymeter says realign, polyrhythm says loop; thousands separators', () => {
  let s = song.createSong({ bpm: 120 });
  assert.equal(r.loopReadout(s.scenes[0], 120), 'add a lane to start');
  s = song.addLane(song.addLane(s, 'kick', { id: 'k' }), 'sine', { id: 'b' });
  s = song.setBeats(s, 0, 'b', 3);
  assert.equal(r.loopReadout(s.scenes[0], 120), 'lanes realign every 12 beats · 0:03');
  assert.equal(r.loopReadout(song.setPolytoggle(s, 0, 'polyrhythm').scenes[0], 120), 'all lanes loop every 4 beats · 0:01');
  let big = song.createSong({ bpm: 120 });
  for (const n of [16, 17, 19, 20, 11, 13, 9]) {
    big = song.addLane(big, 'sine');
    big = song.setBeats(big, 0, big.lanes.at(-1).id, n);
  }
  assert.match(r.loopReadout(big.scenes[0], 120), /^lanes realign every 33,256,080 beats · 2309:27:00$/);
  let one = song.addLane(song.createSong(), 'sine');
  one = song.setBeats(one, 0, one.lanes[0].id, 1);
  assert.match(r.loopReadout(one.scenes[0], 30), /every 1 beat · 0:01/);
});

test('short loop readout for phones', () => {
  let s = song.addLane(song.addLane(song.createSong({ bpm: 120 }), 'kick', { id: 'k' }), 'sine', { id: 'b' });
  s = song.setBeats(s, 0, 'b', 3);
  assert.equal(r.loopShort(s.scenes[0], 120), 'realign 12 · 0:03');
  assert.equal(r.loopShort(song.setPolytoggle(s, 0, 'polyrhythm').scenes[0], 120), 'loop 4 · 0:01');
  assert.equal(r.loopShort(song.createSong().scenes[0], 120), '');
});

test('names: short and full', () => {
  assert.equal(r.shortName(0), 'A4');
  assert.equal(r.shortName(-2900), 'E2');
  assert.equal(r.shortName(300), 'C5');
  assert.equal(r.fullName(-3300), 'C2');
  assert.equal(r.fullName(105), 'A#4 +5¢');
  assert.deepEqual(r.splitPitch(105), { name: 'A#', octave: 4, offset: 5, label: 'A# +5¢' });
});

test('names to cents, both ways', () => {
  assert.equal(r.centsFromName('A', 4), 0);
  assert.equal(r.centsFromName('C', 5), 300);
  assert.equal(r.centsFromName('c', 2), -3300);
  assert.equal(r.centsFromName('F#', 4, 5), -300 + 5);
  assert.equal(r.centsFromName('H', 4), null);
  for (const c of [-3300, -2900, 0, 300, 1200]) {
    const p = r.splitPitch(c);
    assert.equal(r.centsFromName(p.name, p.octave, p.offset), c);
  }
});

test('pitch text: names, sharps, flats, cents', () => {
  assert.deepEqual(r.parsePitchText('F#'), { name: 'F#', offset: 0 });
  assert.deepEqual(r.parsePitchText(' f# +5¢ '), { name: 'F#', offset: 5 });
  assert.deepEqual(r.parsePitchText('Bb'), { name: 'A#', offset: 0 });
  assert.deepEqual(r.parsePitchText('A −12'), { name: 'A', offset: -12 });
  assert.deepEqual(r.parsePitchText('Cb'), { name: 'B', offset: 0 });
  assert.equal(r.parsePitchText('H'), null);
  assert.equal(r.parsePitchText('C#5'), null);
});

test('Hz to cents snaps to the tuning', () => {
  assert.equal(r.hzToCents(440, '12-edo'), 0);
  near(r.hzToCents(450, 'free'), 1200 * Math.log2(450 / 440));
  assert.equal(r.hzToCents(450, '12-edo'), 0);
  near(r.hzToCents(523.2511, '12-edo'), 300);
});

test('arrow keys step one step of the lane tuning', () => {
  assert.equal(r.stepPitch(0, '12-edo', 1), 100);
  assert.equal(r.stepPitch(0, '12-edo', -1), -100);
  assert.equal(r.stepPitch(0, '24-edo', 1), 50);
  near(r.stepPitch(0, '19-edo', 1), 1200 / 19);
  near(r.stepPitch(1200 / 19, '19-edo', 1), 2400 / 19);
  assert.equal(r.stepPitch(130, '12-edo', 1), 200); // off the grid: to the next step
  assert.equal(r.stepPitch(130, '12-edo', -1), 100);
  assert.equal(r.stepPitch(130, 'free', 1), 131);
});

test('step text only in 19, 24 and 31-EDO', () => {
  assert.equal(r.stepText(0, '12-edo'), '');
  assert.equal(r.stepText(0, 'free'), '');
  assert.equal(r.stepText(0, '19-edo'), 'step 0 of 19');
  near(0, 0);
  assert.equal(r.stepText(1200 / 19, '19-edo'), 'step 1 of 19');
  assert.equal(r.stepText(-1200 / 19, '19-edo'), 'step 18 of 19');
});

import { encodeWav, MAX_EXPORT_SECONDS } from '../polytoggle/wav.js';

test('WAV: header, sizes and 16-bit samples', () => {
  const buf = encodeWav([Float32Array.from([0, 1, -1, 0.5]), Float32Array.from([0, 0, 0, 0])], 44100);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(buf.byteLength, 44 + 4 * 2 * 2);
  assert.equal(v.getUint32(4, true), buf.byteLength - 8);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(40, true), 16);
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(48, true), 32767); // sample 1, left
  assert.equal(v.getInt16(52, true), -32768);
  assert.equal(MAX_EXPORT_SECONDS, 600);
});
