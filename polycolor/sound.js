// polycolor sound: Web Audio. Each color sounds as its note: a sine with a soft attack and release,
// plus band-passed noise for the unsaturated part of the color (shared color model). Brightness
// is the volume. Tone and noise mix at equal power, and the noise gets makeup gain for its narrow
// band, so the sweep from a pure tone to white noise is even. A swatch plays for about a second;
// Play chord holds every swatch until stopped; dragging a dot holds a live voice that follows it.

import { noiseBandQ, noiseBandMakeup, WHITE_NOISE_TRIM } from '../shared/color.js';

const ATTACK = 0.03;
const RELEASE = 0.12;
const FOLLOW = 0.012; // s: time constant for a live voice following a drag

export function createSound(ctx) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 3; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.1;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(limiter);

  const noiseBuffer = (() => {
    const n = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * WHITE_NOISE_TRIM;
    return buf;
  })();

  const nyquist = () => ctx.sampleRate / 2 - 100;

  /**
   * Start a voice now. spec: { freq, gain, tone, noise, saturation } from model.soundOf + pitchOf.
   * `scale` shares headroom between voices of a chord. Returns { set(spec), stop(), done }.
   */
  function voice(spec, scale = 1) {
    const now = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(spec.gain * 0.5 * scale, now + ATTACK);
    env.connect(master);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const toneGain = ctx.createGain();
    osc.connect(toneGain).connect(env);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const filtered = ctx.createGain(); // noise through the pitch band
    const open = ctx.createGain(); // unfiltered noise, only at 0% saturation
    src.connect(bp).connect(filtered).connect(env);
    src.connect(open).connect(env);

    function apply(s, at, smooth) {
      const f = Math.min(nyquist(), s.freq);
      const q = noiseBandQ(s.saturation);
      const set = (param, value) => (smooth ? param.setTargetAtTime(value, at, FOLLOW) : param.setValueAtTime(value, at));
      set(osc.frequency, f);
      set(toneGain.gain, s.tone);
      set(bp.frequency, f);
      set(bp.Q, q ?? 0.4);
      set(filtered.gain, q === null ? 0 : s.noise * noiseBandMakeup(q, f, ctx.sampleRate));
      set(open.gain, q === null ? s.noise : 0);
      if (smooth) env.gain.setTargetAtTime(s.gain * 0.5 * scale, at, FOLLOW);
    }
    apply(spec, now, false);
    osc.start(now);
    src.start(now, Math.random() * 1.5);

    let stopped = false;
    let finish;
    const done = new Promise((r) => { finish = r; });
    osc.onended = () => finish();
    return {
      done,
      /** Follow a new spec (the dot moved): pitch, noise and level glide, no click. */
      set(next) {
        if (!stopped) apply(next, ctx.currentTime, true);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(env.gain.value, t);
        env.gain.linearRampToValueAtTime(0, t + RELEASE);
        osc.stop(t + RELEASE + 0.02);
        src.stop(t + RELEASE + 0.02);
      },
    };
  }

  let single = null;
  let live = null;
  let chord = [];

  return {
    get playingNote() { return single !== null; },
    get playingChord() { return chord.length > 0; },

    /** A swatch's note for about a second. Resolves when it has ended or been stopped. */
    playNote(spec, seconds = 1) {
      this.stopNote();
      const v = voice(spec);
      single = v;
      const timer = setTimeout(() => v.stop(), seconds * 1000);
      return v.done.then(() => { clearTimeout(timer); if (single === v) single = null; });
    },
    stopNote() {
      single?.stop();
      single = null;
    },

    /** Hold a voice that follows a dot being dragged: call update(spec) as it moves, end() on release. */
    startLive(spec) {
      this.endLive();
      this.stopNote();
      live = voice(spec);
    },
    updateLive(spec) { live?.set(spec); },
    endLive() {
      live?.stop();
      live = null;
    },
    get playingLive() { return live !== null; },

    /** Every swatch together, held until stopChord(). */
    startChord(specs) {
      this.stopChord();
      const scale = 1 / Math.sqrt(Math.max(1, specs.length));
      chord = specs.map((s) => voice(s, scale));
    },
    stopChord() {
      for (const v of chord) v.stop();
      chord = [];
    },
    /**
     * Move the held chord's voices to new specs (one per voice, same order) so a dot being dragged
     * glides instead of leaving its old note behind. False when the number of voices differs: the
     * caller restarts the chord.
     */
    updateChord(specs) {
      if (!chord.length || specs.length !== chord.length) return false;
      chord.forEach((v, i) => v.set(specs[i]));
      return true;
    },

    setMaster(gain) {
      master.gain.setTargetAtTime(gain, ctx.currentTime, 0.015);
    },
  };
}
