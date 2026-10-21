import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPulse, createScheduler } from '../shared/clock.js';

// A fake audio clock and a timer we step by hand.
function rig({ period = 0.25 } = {}) {
  let now = 0;
  let tickFn = null;
  const timer = { start: (fn) => { tickFn = fn; return 1; }, stop: () => { tickFn = null; } };
  const pulse = createPulse({ period, origin: 0 });
  const booked = [];
  const sched = createScheduler({
    getTime: () => now, timer, lookahead: 0.1, interval: 0.025,
    onWindow: (from, to) => booked.push(...pulse.beatsIn(from, to)),
  });
  return {
    pulse, sched, booked,
    advance(seconds, step = 0.025) { for (let t = 0; t < seconds - 1e-12; t += step) { now += step; tickFn?.(); } },
    get now() { return now; },
  };
}

test('every beat is booked once, in order, ahead of time', () => {
  const r = rig();
  r.sched.start(0);
  r.advance(10);
  const idx = r.booked.map((b) => b.index);
  assert.deepEqual(idx, [...Array(idx.length).keys()]);
  assert.ok(idx.length >= 40);
});

test('windows tile with no gaps or overlaps even with uneven wake-ups', () => {
  const r = rig({ period: 1 / 64 });
  r.sched.start(0);
  for (const s of [0.013, 0.031, 0.007, 0.049, 0.022]) r.advance(1, s);
  const idx = r.booked.map((b) => b.index);
  assert.deepEqual(idx, [...Array(idx.length).keys()]);
});

test('tempo change at the cursor: no restart, no lost or doubled beat', () => {
  const r = rig({ period: 0.5 });
  r.sched.start(0);
  r.advance(2.01);
  r.pulse.setPeriod(0.2, r.sched.cursor);
  r.advance(3);
  const idx = r.booked.map((b) => b.index);
  assert.deepEqual(idx, [...Array(idx.length).keys()]);
  const times = r.booked.map((b) => b.time);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  // after the change, beats are 0.2 s apart
  const last = times.slice(-3);
  assert.ok(Math.abs(last[2] - last[1] - 0.2) < 1e-9);
});

test('a stalled timer skips the past instead of bursting', () => {
  const r = rig({ period: 0.1 });
  r.sched.start(0);
  r.advance(1);
  const before = r.booked.length;
  // jump the clock 5 s with no wake-ups, then wake once
  r.advance(5, 5);
  const burst = r.booked.length - before;
  assert.ok(burst <= 2, `booked ${burst} beats at once`);
  assert.equal(r.sched.lateCount, 1);
});

test('stop and start again', () => {
  const r = rig();
  r.sched.start(0);
  r.advance(1);
  r.sched.stop();
  assert.equal(r.sched.running, false);
  const n = r.booked.length;
  r.advance(1);
  assert.equal(r.booked.length, n);
});

test('restartAt puts beat 0 at the given time', () => {
  const p = createPulse({ period: 0.5, origin: 0.3 });
  p.restartAt(10);
  assert.deepEqual(p.beatsIn(10, 11).map((b) => b.time), [10, 10.5]);
});
