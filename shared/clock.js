// clock.js: timing shared by all three apps.
//
// Sound is booked on the audio clock (AudioContext.currentTime) by a lookahead scheduler:
// a timer wakes about every 25 ms and books the next ~100 ms of events. The screen follows
// the audio: once per frame, read the audio clock and move the playheads.
// See https://web.dev/articles/audio-scheduling
//
// createPulse and createScheduler are pure (time and timers are injected) so they run under
// node --test. The browser helpers at the bottom touch window and Web Audio.

// ---------- Pulse: an evenly spaced beat on a timeline ----------

/**
 * A steady beat: beat `index` falls at origin + index × period (seconds).
 * Change the period with setPeriod at the scheduler's cursor and the beat carries on
 * without a restart, a doubled beat or a lost one.
 */
export function createPulse({ period, origin = 0 }) {
  if (!(period > 0)) throw new RangeError('period must be > 0');
  const p = { period, origin };

  /** Fractional beat count at time t (beat 0 = 0). */
  const phaseAt = (t) => (t - p.origin) / p.period;

  /** Index of the first beat at or after time t. The same t always gives the same index. */
  const firstIndexAtOrAfter = (t) => Math.ceil(phaseAt(t));

  return {
    get period() { return p.period; },
    get origin() { return p.origin; },
    phaseAt,
    timeOf: (index) => p.origin + index * p.period,

    /** Beats in the half-open window [from, to): [{ index, time }]. */
    beatsIn(from, to) {
      const out = [];
      const end = firstIndexAtOrAfter(to);
      for (let k = firstIndexAtOrAfter(from); k < end; k++) out.push({ index: k, time: p.origin + k * p.period });
      return out;
    },

    /** Change speed at time `at`, keeping the phase continuous. Pass the scheduler's cursor. */
    setPeriod(period, at) {
      if (!(period > 0)) throw new RangeError('period must be > 0');
      const ph = phaseAt(at);
      p.period = period;
      p.origin = at - ph * period;
    },

    /** Make beat `index` land at `time` (restart from beat 1 is restartAt(t, 0)). */
    restartAt(time, index = 0) {
      p.origin = time - index * p.period;
    },
  };
}

// ---------- Scheduler: the lookahead loop ----------

/**
 * @param {object} o
 * @param {() => number} o.getTime          the audio clock, in seconds
 * @param {(from: number, to: number) => void} o.onWindow  book every event in [from, to)
 * @param {number} [o.lookahead=0.1]        seconds booked ahead
 * @param {number} [o.interval=0.025]       seconds between wake-ups
 * @param {{start(fn: () => void, ms: number): any, stop(handle: any): void}} [o.timer]
 */
export function createScheduler({ getTime, onWindow, lookahead = 0.1, interval = 0.025, timer = defaultTimer() }) {
  let cursor = 0;
  let handle = null;
  let late = 0;

  function tick() {
    const now = getTime();
    if (cursor < now) {
      // The timer was held up (a background tab, a busy main thread). Skip what is already
      // past instead of firing it all at once.
      late++;
      cursor = now;
    }
    const horizon = now + lookahead;
    if (horizon > cursor) {
      const from = cursor;
      cursor = horizon;
      onWindow(from, horizon);
    }
  }

  return {
    /** Start booking from audio time `at` (default: now). */
    start(at = getTime()) {
      if (handle !== null) return;
      cursor = at;
      late = 0;
      tick();
      handle = timer.start(tick, interval * 1000);
    },
    stop() {
      if (handle === null) return;
      timer.stop(handle);
      handle = null;
    },
    get running() { return handle !== null; },
    /** Everything before this time is booked. Apply tempo and pattern changes here. */
    get cursor() { return cursor; },
    /** How many times the scheduler fell behind since start (for debugging). */
    get lateCount() { return late; },
    tick,
  };
}

// ---------- Browser helpers ----------

/**
 * A timer that keeps waking in background tabs: setInterval inside a Worker, which browsers
 * throttle far less than the main thread. Falls back to plain setInterval.
 */
export function defaultTimer() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return { start: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h) };
  }
  const src = 'let h=null;onmessage=e=>{clearInterval(h);h=e.data>0?setInterval(()=>postMessage(0),e.data):null}';
  let worker = null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch {
    return { start: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h) };
  }
  return {
    start(fn, ms) { worker.onmessage = fn; worker.postMessage(ms); return worker; },
    stop() { worker.postMessage(0); worker.onmessage = null; },
  };
}

let sharedContext = null;

/** The page's one AudioContext, made on first use. */
export function getAudioContext() {
  if (!sharedContext) {
    // iOS: play through the silent switch, like a music app.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    sharedContext = new AudioContext({ latencyHint: 'interactive' });
  }
  return sharedContext;
}

/** Call from the first click or key press that should make sound. Browsers need a gesture. */
export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

/** The audio time being heard right now: currentTime minus the output delay. For drawing. */
export function heardTime(ctx) {
  const delay = (Number.isFinite(ctx.outputLatency) && ctx.outputLatency) || ctx.baseLatency || 0;
  return ctx.currentTime - delay;
}

/**
 * Once per frame, call onFrame(time) with the audio time being heard. Move playheads with
 * a transform or a class change in onFrame; never rebuild the grid.
 */
export function createFrameLoop({ getTime, onFrame }) {
  let id = 0;
  const loop = () => { onFrame(getTime()); id = requestAnimationFrame(loop); };
  return {
    start() { if (!id) id = requestAnimationFrame(loop); },
    stop() { cancelAnimationFrame(id); id = 0; },
    get running() { return id !== 0; },
  };
}
