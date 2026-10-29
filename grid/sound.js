// polygrid sound: Web Audio, no samples.
//
// Every row plays one short click, a 1–4 ms "tick": the same shape on every row, centred low on
// Row 1, mid on Row 2 and high on Row 3 so rows are easy to tell apart. The tick only colours the
// sound; a row's pitch is always its rate. Below 20 beats a second each tick is booked
// ahead on the audio clock. From 20 up, the row hands over, on a beat, to one oscillator whose
// waveform is the Fourier series of that same tick train at the row's rate. At the hand-over the
// two are the same signal, so nothing jumps; above it the oscillator keeps tracking what a real
// tick train would sound like at that rate, recalculated as the speed changes.
//
// Loudness: a tick train's power grows with its rate (twice the ticks, twice the energy), so a
// row's gain falls as 1 / sqrt(rate) above LOUDNESS_REF beats a second, the same in both modes.

import { createPulse, createScheduler } from '../shared/clock.js';
import { FUSE_RATE } from './model.js';

const RAMP = 0.015; // s, time constant for gain moves
export const LOUDNESS_REF = 8; // beats a second where loudness compensation starts

/**
 * A tick: a Gaussian monocycle (no DC), peak 1, its energy centred near `peakHz`.
 * @returns {{ peakHz: number, length: number, at(t: number): number }}
 */
export function makeTick(peakHz) {
  const sigma = 1 / (Math.SQRT2 * Math.PI * peakHz); // Gaussian width, s
  const t0 = 4 * sigma; // centre, so it starts from silence
  const length = 8 * sigma;
  return {
    peakHz, length,
    at(t) {
      if (t < 0 || t > length) return 0;
      const u = (t - t0) / sigma;
      return -u * Math.exp(0.5 - (u * u) / 2); // peak magnitude 1 at u = ±1
    },
  };
}

/** One tick per row: low, mid, high. */
export const ROW_TICKS = [makeTick(400), makeTick(800), makeTick(1600)];

/** Gain for a row at `rate` beats a second: 1 up to LOUDNESS_REF, then constant power. */
export function rateGain(rate) {
  return rate <= LOUDNESS_REF ? 1 : Math.sqrt(LOUDNESS_REF / rate);
}

/** A-weighting as a power ratio: how loud the ear hears each frequency (1 at 1 kHz). */
export function aWeight(f) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return (ra * 10 ** (2 / 20)) ** 2;
}

/** How loud a wave with these coefficients sounds: A-weighted power. */
export function heardPower({ real, imag }, rate) {
  let p = 0;
  for (let k = 1; k < real.length; k++) p += ((real[k] ** 2 + imag[k] ** 2) / 2) * aWeight(k * rate);
  return p;
}

const fusePower = new Map(); // tick -> heard power of its train at the fuse point
function fusePowerOf(tk) {
  if (!fusePower.has(tk)) fusePower.set(tk, heardPower(tickTrainCoefficients(FUSE_RATE, tk), FUSE_RATE) * rateGain(FUSE_RATE) ** 2);
  return fusePower.get(tk);
}

/**
 * Extra gain on top of rateGain for a tone at `rate`, so every tone sounds as loud as its tick
 * train does at the fuse point. 1 at the fuse point, so the hand-over doesn't jump.
 */
export function toneTrim(coefficients, rate, tk = ROW_TICKS[1]) {
  return Math.min(1000, Math.sqrt(fusePowerOf(tk) / (heardPower(coefficients, rate) * rateGain(rate) ** 2)));
}

/** Evens the three ticks out by ear, so a low tick isn't quieter than a high one. Mid = 1. */
export function tickBalance(tk) {
  return Math.sqrt(fusePowerOf(ROW_TICKS[1]) / fusePowerOf(tk));
}

/**
 * Fourier coefficients of a tick train at `rate` Hz, for createPeriodicWave.
 * a_k = 2·rate·∫tick(t)cos(2πk·rate·t)dt, b_k likewise with sin.
 */
export function tickTrainCoefficients(rate, tk = ROW_TICKS[1], sampleRate = 48000, maxHarmonics = 4096) {
  // A tick has next to nothing above 10 × its centre (under -100 dB), so stop there.
  const top = Math.min(sampleRate / 2, 10 * tk.peakHz);
  const harmonics = Math.max(1, Math.min(maxHarmonics, Math.floor(top / rate)));
  const dt = 1 / 96000; // integrate finely over the tick
  const n = Math.ceil(tk.length / dt);
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = tk.at(i * dt);
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    const w = 2 * Math.PI * k * rate * dt;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { re += xs[i] * Math.cos(w * i); im += xs[i] * Math.sin(w * i); }
    real[k] = 2 * rate * re * dt;
    imag[k] = 2 * rate * im * dt;
  }
  return { real, imag };
}

function tickBuffer(ctx, tk) {
  const n = Math.ceil(tk.length * ctx.sampleRate) + 1;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = tk.at(i / ctx.sampleRate);
  return buf;
}

export function createSound(ctx) {
  const out = ctx.createDynamicsCompressor(); // a safety limiter: three rows can land together
  out.threshold.value = -3; out.knee.value = 3; out.ratio.value = 20; out.attack.value = 0.001; out.release.value = 0.1;
  out.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(out);

  const waveCache = new Map();
  function waveFor(row, rate) {
    const rounded = Math.round(rate * 100) / 100; // 0.01 Hz steps are plenty
    const key = `${row.tick.peakHz}:${rounded}`;
    let w = waveCache.get(key);
    if (!w) {
      const c = tickTrainCoefficients(rounded, row.tick, ctx.sampleRate);
      w = { wave: ctx.createPeriodicWave(c.real, c.imag, { disableNormalization: true }), trim: toneTrim(c, rounded, row.tick) };
      if (waveCache.size > 200) waveCache.clear();
      waveCache.set(key, w);
    }
    return w;
  }

  const rows = ROW_TICKS.map((tk) => {
    const level = ctx.createGain(); // row volume and mute
    const comp = ctx.createGain(); // loudness by rate
    const balance = ctx.createGain(); // evens the three ticks out by ear
    balance.gain.value = tickBalance(tk);
    balance.connect(comp).connect(level).connect(master);
    return { tick: tk, buffer: tickBuffer(ctx, tk), level, comp, balance, beats: 0, osc: null, oscGain: null, oscRate: 0 };
  });

  let hz = 0.5;
  const cycle = createPulse({ period: 1 / hz, origin: 0 });
  const live = new Set(); // booked ticks, so pause can cancel the ones not yet heard
  let pausedPhase = 0;

  function bookTick(row, time) {
    const src = ctx.createBufferSource();
    src.buffer = row.buffer;
    src.connect(row.balance);
    src.start(time);
    const entry = { src, time };
    live.add(entry);
    src.onended = () => live.delete(entry);
  }

  function toneOn(row, at, rate) {
    const osc = ctx.createOscillator();
    const w = waveFor(row, rate);
    osc.setPeriodicWave(w.wave);
    osc.frequency.setValueAtTime(rate, at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(w.trim, at);
    osc.connect(g).connect(row.balance);
    osc.start(at); // starts on a beat, where the tick train's cycle starts: in phase
    row.osc = osc; row.oscGain = g; row.oscRate = rate;
  }

  function retune(row, rate, at) {
    const w = waveFor(row, rate);
    row.osc.setPeriodicWave(w.wave);
    row.oscGain.gain.setTargetAtTime(w.trim, at, RAMP);
    row.oscRate = rate;
  }

  function toneOff(row, at) {
    if (!row.osc) return;
    row.osc.stop(at); // stops on a beat, between ticks, where the wave is silent
    row.osc = null; row.oscGain = null;
  }

  function onWindow(from, to) {
    rows.forEach((row) => {
      const n = row.beats;
      if (!n) { toneOff(row, from); return; }
      const rate = n * hz;
      const beat = createPulse({ period: cycle.period / n, origin: cycle.origin });
      const beats = beat.beatsIn(from, to);
      if (rate >= FUSE_RATE) {
        if (!row.osc && beats.length) toneOn(row, beats[0].time, rate);
        return;
      }
      if (row.osc) {
        if (!beats.length) return; // keep the tone until the next beat
        toneOff(row, beats[0].time);
      }
      for (const b of beats) bookTick(row, b.time);
    });
  }

  const scheduler = createScheduler({ getTime: () => ctx.currentTime, onWindow });

  function applyRateGains(at) {
    rows.forEach((row) => row.comp.gain.setTargetAtTime(rateGain(row.beats * hz), at, RAMP));
  }

  return {
    get playing() { return scheduler.running; },

    /** Cycle phase (fractional cycles) at audio time t, for drawing. Paused: where it stopped. */
    phaseAt(t) { return scheduler.running ? cycle.phaseAt(t) : pausedPhase; },

    play() {
      if (scheduler.running) return;
      const start = ctx.currentTime + 0.05;
      cycle.restartAt(start, pausedPhase);
      applyRateGains(ctx.currentTime);
      scheduler.start(start);
    },

    pause() {
      if (!scheduler.running) return;
      const now = ctx.currentTime;
      pausedPhase = cycle.phaseAt(now);
      scheduler.stop();
      for (const e of live) if (e.time > now) { try { e.src.stop(now); } catch { /* already stopped */ } }
      for (const row of rows) {
        if (!row.osc) continue;
        row.oscGain.gain.setTargetAtTime(0, now, 0.005);
        row.osc.stop(now + 0.05);
        row.osc = null;
      }
    },

    /** Cycles a second. Changes smoothly while playing: no restart, no lost beat. */
    setHz(next) {
      if (next === hz) return;
      hz = next;
      if (scheduler.running) {
        const at = scheduler.cursor; // everything before this is already booked at the old speed
        cycle.setPeriod(1 / hz, at);
        for (const row of rows) {
          if (!row.osc) continue;
          const rate = row.beats * hz;
          row.osc.frequency.setValueAtTime(rate, at);
          if (Math.abs(rate / row.oscRate - 1) > 0.01) retune(row, rate, at);
        }
        applyRateGains(at);
      } else {
        cycle.setPeriod(1 / hz, cycle.timeOf(pausedPhase));
        applyRateGains(ctx.currentTime);
      }
    },

    setBeats(r, n) {
      const row = rows[r];
      if (row.beats === n) return;
      row.beats = n;
      if (row.osc && n) {
        const at = scheduler.cursor;
        row.osc.frequency.setValueAtTime(n * hz, at);
        retune(row, n * hz, at);
      }
      row.comp.gain.setTargetAtTime(rateGain(n * hz), ctx.currentTime, RAMP);
    },

    setRowGain(r, gain) { rows[r].level.gain.setTargetAtTime(gain, ctx.currentTime, RAMP); },

    setMaster(gain) { master.gain.setTargetAtTime(gain, ctx.currentTime, RAMP); },
  };
}
