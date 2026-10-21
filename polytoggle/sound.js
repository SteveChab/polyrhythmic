// polytoggle sound: Web Audio, synthesized, no samples. Spec: polytoggle-spec.md, "Sound".
//
// Every note, drum or synth, is built the same way: a tonal part and a noise part, mixed by the
// note's noise setting (the shared color model: saturation = 100 − noise), then shaped by the
// lane's ADSR. Instruments differ in their tonal part (waveform, partials, a pitch sweep for
// kicks and toms) and where their noise is centered. The noise goes through a band-pass filter
// centered on the note's pitch that widens as saturation drops, and is unfiltered at 0%.
//
// The pure functions at the top (envelope curve, noise mix, band width, voice table) are tested;
// createSound() at the bottom touches the AudioContext.

import { equalPowerMix, dbToGain, noiseBandQ as bandQ, noiseBandMakeup, WHITE_NOISE_TRIM } from '../shared/color.js';
import { centsToHz, getInstrument, DB_MIN } from './song.js';

// ---------- Pure: envelope ----------

const MIN_ATTACK = 0.001; // s: shorter than this clicks
const MIN_RELEASE = 0.005;
const CURVE_POINTS = 8;

/** 1 at x = 0 falling to 0 at x = 1, the shape of an analog decay. */
const fall = (x) => (Math.exp(-5 * x) - Math.exp(-5)) / (1 - Math.exp(-5));

/**
 * The gain curve of one note as breakpoints [{ t, v }] (seconds from the note start, gain), joined
 * by straight lines. `dur` is how long the note is held; the release starts there. A note
 * released mid-attack or mid-decay releases from wherever the curve had got to.
 */
export function adsrPoints(env, peak, dur) {
  const A = Math.max(MIN_ATTACK, env.attackMs / 1000);
  const D = Math.max(0, env.decayMs / 1000);
  const R = Math.max(MIN_RELEASE, env.releaseMs / 1000);
  const S = (env.sustainPct / 100) * peak;

  const held = (t) => {
    if (t <= 0) return 0;
    if (t < A) return (peak * t) / A;
    if (t < A + D) return S + (peak - S) * fall((t - A) / D);
    return S;
  };

  const pts = [{ t: 0, v: 0 }];
  const add = (t, v) => {
    if (t > pts[pts.length - 1].t) pts.push({ t, v });
  };
  if (dur > A) add(A, peak);
  const decayEnd = Math.min(A + D, dur);
  if (D > 0 && S < peak) {
    for (let i = 1; i <= CURVE_POINTS; i++) {
      const t = A + ((decayEnd - A) * i) / CURVE_POINTS;
      if (t > A) add(t, held(t));
    }
  }
  const v0 = held(dur);
  add(dur, v0);
  for (let i = 1; i <= CURVE_POINTS; i++) add(dur + (R * i) / CURVE_POINTS, i === CURVE_POINTS ? 0 : v0 * fall(i / CURVE_POINTS));
  return pts;
}

/** When a note's sound is over, in seconds from its start. */
export const voiceLength = (env, dur) => dur + Math.max(MIN_RELEASE, env.releaseMs / 1000);

// ---------- Pure: noise ----------

/** Gains for the tonal and noise parts of a note whose noise setting is `noisePct`. */
export function toneNoiseGains(noisePct) {
  return equalPowerMix(100 - noisePct);
}

/** Q of the band-pass filter on a note's noise, or null for none (see color.js noiseBandQ). */
export const noiseBandQ = (noisePct) => bandQ(100 - noisePct);

/** Gain of a note from its volume in dB: silent at the floor. */
export const noteGain = (db) => (db <= DB_MIN ? 0 : dbToGain(db));

// ---------- Pure: instruments ----------

// tones: partials as { wave, ratio, gain }. sweep: the pitch starts at from × pitch and falls to
// the pitch over `time` seconds. lowpass: cutoff as a multiple of pitch. noiseCenter: where the
// noise band sits, as a multiple of pitch. drive: tanh saturation on the tones, which adds the
// harmonics that make a sub-bass audible on small speakers. level: overall trim. These are first sketches, to be
// tuned by ear.
// Per-partial options: sweep overrides the voice's pitch sweep for that partial; decay is a time
// constant in seconds after which the partial fades away on its own (clicks, rings, overtones).
const tone = (wave, ratio = 1, gain = 1, opts = {}) => ({ wave, ratio, gain, ...opts });

export const VOICES = Object.freeze({
  sine: { tones: [tone('sine')] },
  triangle: { tones: [tone('triangle')] },
  square: { tones: [tone('square')], level: 0.45 },
  saw: { tones: [tone('sawtooth')], level: 0.5 },
  'saw-bass': { tones: [tone('sawtooth', 1, 0.7), tone('square', 0.5, 0.35)], lowpass: 5, level: 0.7 },
  'electric-piano': { tones: [tone('sine', 1, 1), tone('sine', 2, 0.32), tone('sine', 4, 0.1)] },
  // Kick: a tight thump with a short beater click on top.
  kick: { tones: [tone('sine', 1, 1), tone('triangle', 9, 0.3, { decay: 0.008 })], sweep: { from: 3.5, time: 0.05 }, level: 1.8 },
  snare: { tones: [tone('triangle')], sweep: { from: 1.7, time: 0.03 }, noiseCenter: 6, level: 2 },
  clap: { tones: [tone('sine', 1, 0.4)], level: 2 },
  // Floor tom: higher than the kick, a ringing head (the drum-membrane overtones at 1.59 and 2.14).
  'floor-tom': { tones: [tone('sine', 1, 1), tone('sine', 1.59, 0.45, { decay: 0.16 }), tone('sine', 2.14, 0.25, { decay: 0.09 }), tone('triangle', 3.2, 0.12, { decay: 0.02 })], sweep: { from: 1.45, time: 0.11 }, level: 1.4 },
  'closed-hat': { tones: [tone('square', 1, 0.5), tone('square', 1.4, 0.4), tone('square', 1.71, 0.3)], level: 3 },
  'open-hat': { tones: [tone('square', 1, 0.5), tone('square', 1.4, 0.4), tone('square', 1.71, 0.3)], level: 2 },
  // 808 kick: a long, low sub boom with a slow pitch drop, driven so it speaks on small speakers.
  '808-kick': { tones: [tone('sine', 1, 1), tone('sine', 2, 0.22, { decay: 0.35 })], sweep: { from: 2.4, time: 0.14 }, drive: 2.2, level: 0.9 },
  // Ride: inharmonic metal partials that ring, a bright ping and a little sizzle (noise).
  ride: { tones: [tone('square', 1, 0.5, { decay: 0.9 }), tone('square', 1.4471, 0.45, { decay: 0.75 }), tone('square', 1.617, 0.4, { decay: 0.8 }), tone('square', 1.9265, 0.35, { decay: 0.6 }), tone('square', 2.5028, 0.3, { decay: 0.5 }), tone('square', 2.6637, 0.25, { decay: 0.45 }), tone('sine', 1.2, 0.5, { decay: 0.12 })], noiseCenter: 1.8, level: 1.6 },
  '808-cowbell': { tones: [tone('square', 1, 0.6), tone('square', 1.4815, 0.6)], level: 1.5 },
});

// ---------- Web Audio ----------

/** A tanh saturation curve of strength k, scaled so full scale stays full scale. */
export function driveCurve(k, n = 1024) {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1) * 2 - 1) * k) / norm;
  return c;
}

const SAFETY = 0.5; // per-voice headroom: eight lanes can land together

function makeNoiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * WHITE_NOISE_TRIM;
  return buf;
}

export function createSound(ctx) {
  const limiter = ctx.createDynamicsCompressor(); // a safety limiter
  limiter.threshold.value = -3; limiter.knee.value = 3; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.1;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(limiter);
  const noiseBuffer = makeNoiseBuffer(ctx);

  const channels = new Map(); // laneId -> { input, pan, level }
  const live = new Set(); // voices not yet finished: { start, end, env, sources }

  function channel(laneId) {
    let ch = channels.get(laneId);
    if (!ch) {
      const level = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.connect(level).connect(master);
      ch = { input: pan, pan, level };
      channels.set(laneId, ch);
    }
    return ch;
  }

  /** Book one note on `dest`. `p`: { instrument, cents, noisePct, volumeDb, envelope, start, dur }. */
  function voice(dest, p) {
    const def = VOICES[p.instrument];
    const hz = centsToHz(p.cents);
    const { tone: toneGain, noise: noiseGain } = toneNoiseGains(p.noisePct);
    const peak = noteGain(p.volumeDb) * SAFETY * (def.level ?? 1);
    if (peak <= 0) return;
    const { start } = p;
    const pts = adsrPoints(p.envelope, peak, p.dur);
    const end = start + pts[pts.length - 1].t;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    for (const { t, v } of pts.slice(1)) env.gain.linearRampToValueAtTime(v, start + t);
    env.connect(dest);
    const sources = [];

    if (toneGain > 0) {
      const tail = ctx.createGain();
      tail.gain.value = toneGain;
      const head = tail;
      let out = tail;
      if (def.drive) {
        const shaper = ctx.createWaveShaper();
        shaper.curve = driveCurve(def.drive);
        out.connect(shaper);
        out = shaper;
      }
      if (def.lowpass) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = Math.min(18000, hz * def.lowpass); lp.Q.value = 1;
        out.connect(lp);
        out = lp;
      }
      out.connect(env);
      const total = def.tones.reduce((s, x) => s + x.gain, 0);
      for (const part of def.tones) {
        const osc = ctx.createOscillator();
        osc.type = part.wave;
        const f = Math.min(ctx.sampleRate / 2 - 100, hz * part.ratio);
        const sweep = part.sweep ?? def.sweep;
        if (sweep) {
          osc.frequency.setValueAtTime(Math.min(ctx.sampleRate / 2 - 100, f * sweep.from), start);
          osc.frequency.exponentialRampToValueAtTime(f, start + sweep.time);
        } else {
          osc.frequency.setValueAtTime(f, start);
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(part.gain / total, start);
        if (part.decay) g.gain.setTargetAtTime(0, start, part.decay);
        osc.connect(g).connect(head);
        osc.start(start);
        osc.stop(end + 0.02);
        sources.push(osc);
      }
    }

    if (noiseGain > 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const g = ctx.createGain();
      const q = noiseBandQ(p.noisePct);
      const center = Math.min(ctx.sampleRate / 2 - 100, hz * (def.noiseCenter ?? 1));
      g.gain.value = noiseGain * noiseBandMakeup(q, center, ctx.sampleRate);
      if (q === null) {
        src.connect(g);
      } else {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = center;
        bp.Q.value = q;
        src.connect(bp).connect(g);
      }
      g.connect(env);
      src.start(start, Math.random() * (noiseBuffer.duration - 0.5));
      src.stop(end + 0.02);
      sources.push(src);
    }

    const v = { start, end, env, sources };
    live.add(v);
    sources[0].onended = () => live.delete(v);
  }

  return {
    ctx,

    /** Play a sequencer event (from sequencer.book) on its lane's channel. */
    play(e) {
      voice(channel(e.laneId).input, {
        instrument: e.instrument,
        cents: e.note.cents,
        noisePct: e.note.noisePct,
        volumeDb: e.note.volumeDb,
        envelope: e.lane.envelope,
        start: e.time,
        dur: Math.max(0.01, e.endTime - e.time),
      });
    },

    /** Click an instrument in the list: its default note, right now, through the master. */
    preview(instrumentId, envelope) {
      const inst = getInstrument(instrumentId);
      voice(master, {
        instrument: inst.id,
        cents: inst.cents,
        noisePct: inst.noisePct,
        volumeDb: 0,
        envelope: envelope ?? inst.envelope,
        start: ctx.currentTime + 0.01,
        dur: 0.25,
      });
    },

    /** Hear one note now, through the master: a click on an empty beat. */
    audition(instrumentId, note, envelope) {
      voice(master, {
        instrument: instrumentId,
        cents: note.cents,
        noisePct: note.noisePct,
        volumeDb: note.volumeDb,
        envelope,
        start: ctx.currentTime + 0.01,
        dur: 0.25,
      });
    },

    /** Lane volume and pan from the selected scene's settings. Moves smoothly unless `immediate`. */
    setLane(laneId, { volumeDb, pan }, immediate = false) {
      const ch = channel(laneId);
      if (immediate) {
        ch.level.gain.value = noteGain(volumeDb);
        ch.pan.pan.value = pan;
        return;
      }
      ch.level.gain.setTargetAtTime(noteGain(volumeDb), ctx.currentTime, 0.015);
      ch.pan.pan.setTargetAtTime(pan, ctx.currentTime, 0.015);
    },

    setMaster(db, immediate = false) {
      if (immediate) master.gain.value = noteGain(db);
      else master.gain.setTargetAtTime(noteGain(db), ctx.currentTime, 0.015);
    },

    /** Pause: fade out what is sounding and cancel what is booked but not yet heard. */
    silence() {
      const now = ctx.currentTime;
      for (const v of live) {
        if (v.start > now) {
          for (const s of v.sources) { try { s.stop(now); } catch { /* already stopped */ } }
        } else {
          v.env.gain.cancelScheduledValues(now);
          v.env.gain.setTargetAtTime(0, now, 0.008);
          for (const s of v.sources) { try { s.stop(now + 0.06); } catch { /* already stopped */ } }
        }
      }
      live.clear();
    },
  };
}
