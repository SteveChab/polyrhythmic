// polytoggle sequencer: pure step and timing logic, no DOM or audio. Spec: polytoggle-spec.md,
// "Timing". It turns a song into timed note events for the lookahead scheduler in shared/clock.js
// and answers "where is each playhead at audio time t" for the frame loop.
//
// One global beat clock runs at the BPM (a clock.js pulse). Polymeter: a lane steps once per
// global beat and loops on its own length. Polyrhythm: every lane loops in the time of the longest
// lane, so a lane of n beats steps every (longest ÷ n) global beats.
//
// The sequencer keeps a short history of segments (a restart, a tempo change, an edit) so booking
// uses the newest one while the playheads, which trail the audio, can still ask about the past.
// All times are audio-clock seconds; the caller passes the scheduler's cursor as `at`.

import { createPulse } from '../shared/clock.js';
import { loopBeats } from './song.js';

const secondsPerBeat = (bpm) => 30 / bpm; // BPM counts quarter notes; a beat is an eighth note

/** Global beats one step of a lane lasts, and global beats one loop of it lasts. */
export function laneTiming(scene, laneId) {
  const n = scene.lanes[laneId].beats;
  const span = scene.polytoggle === 'polyrhythm' ? loopBeats(scene) : n;
  return { n, span, stepBeats: span / n };
}

/** Solo and mute: a lane is heard unless muted; if any lane is soloed, only soloed lanes are. Mute wins. */
export function audibleLaneIds(scene) {
  const lanes = Object.entries(scene.lanes);
  const anySolo = lanes.some(([, l]) => l.solo);
  return lanes.filter(([, l]) => !l.mute && (!anySolo || l.solo)).map(([id]) => id);
}

/** Lane ids in song order (scene.lanes is keyed by id; the song's lane list gives the order). */
const laneOrder = (song, scene) => song.lanes.map((l) => l.id).filter((id) => id in scene.lanes);

/**
 * Where each lane's playhead is when the global clock is `phase` beats past a restart.
 * position is fractional steps into the loop, in [0, beats); step is its integer part.
 */
export function playheadAt(scene, laneId, phase) {
  const { n, span } = laneTiming(scene, laneId);
  const p = (((phase * n) / span) % n + n) % n;
  return { laneId, position: p, step: Math.min(n - 1, Math.floor(p)) };
}

export function createSequencer({ song, sceneIndex = 0 }) {
  // segments[i] is in effect from its start until segments[i + 1].start.
  //   kind: 'start' (play or resume), 'restart' (phase 0 at start), 'tempo'/'edit' (carries on).
  let segments = [];
  let paused = { phase: 0, song, sceneIndex }; // used while not playing

  const sceneOf = (seg) => seg.song.scenes[seg.sceneIndex];
  const period = (s) => secondsPerBeat(s.bpm);

  function segIndexAt(t) {
    let found = -1;
    for (let i = 0; i < segments.length && segments[i].start <= t; i++) found = i;
    return found;
  }

  /** The next global beat at or after `at` in the segment in effect then. */
  function nextBeatTime(at) {
    const i = segIndexAt(at);
    if (i < 0) return at;
    const { pulse } = segments[i];
    return pulse.timeOf(Math.ceil(pulse.phaseAt(at)));
  }

  /** A copy of a pulse that carries on at a new period from time `at` with no jump in phase. */
  function retimed(pulse, newPeriod, at) {
    const p = createPulse({ period: pulse.period, origin: pulse.origin });
    p.setPeriod(newPeriod, at);
    return p;
  }

  function insert(seg) {
    // Keep sorted by start; a segment at the same start as an older one replaces its effect.
    let i = segments.length;
    while (i > 0 && segments[i - 1].start > seg.start) i--;
    segments.splice(i, 0, seg);
  }

    const api = {
    get playing() { return segments.length > 0; },

    /** Start from the paused spot (or beat 1) at audio time `at`. Play and pause, never stop. */
    play(at) {
      if (segments.length) return;
      const { phase, song: sg, sceneIndex: si } = paused;
      const pulse = createPulse({ period: period(sg), origin: 0 });
      pulse.restartAt(at, phase);
      segments = [{ start: at, kind: 'start', pulse, song: sg, sceneIndex: si }];
    },

    /** Stop booking and remember the spot. The sound layer cuts anything already booked. */
    pause(at) {
      const i = segIndexAt(at);
      if (i < 0) { // paused before the first beat: keep the spot we resumed from
        segments = [];
        return;
      }
      const seg = segments[i];
      paused = { phase: seg.pulse.phaseAt(at), song: seg.song, sceneIndex: seg.sceneIndex };
      segments = [];
    },

    /** The song and scene whose notes are sounding at audio time `t` (for the tab and grid). */
    sceneAt(t) {
      const i = segIndexAt(t);
      const seg = i < 0 ? paused : segments[i];
      return { song: seg.song, sceneIndex: seg.sceneIndex };
    },

    /**
     * The song changed (a note, a lane, solo, the polytoggle, the BPM). Applies from `at` on; a
     * tempo change keeps the phase, so the beat carries on. A pending restart gets the new song too.
     */
    setSong(next, at) {
      if (!segments.length) {
        paused = { ...paused, song: next };
        return;
      }
      for (const seg of segments) {
        if (seg.start > at) {
          seg.song = next;
          if (seg.kind === 'restart') seg.pulse = createPulse({ period: period(next), origin: seg.start });
        }
      }
      const i = segIndexAt(at);
      if (i < 0) return; // not started yet: the loop above already updated every segment
      const cur = segments[i];
      const edit = { start: at, kind: 'edit', pulse: retimed(cur.pulse, period(next), at), song: next, sceneIndex: cur.sceneIndex };
      if (cur.start === at) segments[i] = { ...edit, kind: cur.kind, start: cur.start };
      else insert(edit);
    },

    /**
     * Restart every lane from beat 1, on the next global beat, optionally in another scene (and
     * with a new song). Switching scenes, the polytoggle and Restart all use this. Returns the
     * audio time the change lands. While paused it takes effect at once, and play starts at beat 1.
     */
    restart(at, { sceneIndex: si, song: next } = {}) {
      if (!segments.length) {
        paused = { phase: 0, song: next ?? paused.song, sceneIndex: si ?? paused.sceneIndex };
        return at;
      }
      const cur = segments[Math.max(0, segIndexAt(at))];
      const sg = next ?? cur.song;
      const scene = si ?? cur.sceneIndex;
      // A restart still pending is replaced by this one.
      segments = segments.filter((s) => !(s.kind === 'restart' && s.start > at));
      const T = nextBeatTime(at);
      insert({
        start: T,
        kind: 'restart',
        pulse: createPulse({ period: period(sg), origin: T }),
        song: sg,
        sceneIndex: scene,
      });
      // The tempo applies to the beats between now and T too, so the grid stays one grid.
      if (next && next.bpm !== cur.song.bpm) api.setSong(next, at);
      return T;
    },

    /**
     * Every note that starts in the audio window [from, to): the scheduler's onWindow. Call it with
     * consecutive windows; each event comes out exactly once. Each is
     * { laneId, instrument, lane, time, endTime, step, cycle, note }, in order of time.
     */
    book(from, to) {
      if (!segments.length) return [];
      const events = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const next = segments[i + 1];
        const a = Math.max(from, seg.start);
        const b = Math.min(to, next ? next.start : Infinity);
        if (a >= b) continue;
        const scene = sceneOf(seg);
        const cut = next && next.kind === 'restart' ? next.start : Infinity;
        const phA = seg.pulse.phaseAt(a);
        const phB = seg.pulse.phaseAt(b);
        for (const id of laneOrder(seg.song, scene)) {
          if (!audibleLaneIds(scene).includes(id)) continue;
          const lane = scene.lanes[id];
          if (!lane.notes.length) continue;
          const { n, span, stepBeats } = laneTiming(scene, id);
          const last = Math.ceil((phB * n) / span);
          for (let j = Math.max(0, Math.ceil((phA * n) / span)); j < last; j++) {
            const step = j % n;
            const note = lane.notes.find((x) => x.beat === step);
            if (!note) continue;
            const time = seg.pulse.timeOf((j * span) / n);
            events.push({
              laneId: id,
              instrument: seg.song.lanes.find((l) => l.id === id).instrument,
              lane, // this scene's settings for the lane: envelope, volume, pan, tuning
              time,
              endTime: Math.min(time + note.length * stepBeats * seg.pulse.period, cut),
              step,
              cycle: Math.floor(j / n),
              note,
            });
          }
        }
      }
      return events.sort((x, y) => x.time - y.time);
    },

    /**
     * Playheads at audio time `t` (use the heard time), one per lane in song order, or null before
     * the first beat. Uses the segment in effect at `t`, so a scene change lands on screen when you
     * hear it, not when it was booked.
     */
    playheads(t) {
      let seg;
      let phase;
      if (segments.length) {
        const i = segIndexAt(t);
        if (i < 0) return null;
        seg = segments[i];
        phase = seg.pulse.phaseAt(t);
      } else {
        seg = paused;
        phase = paused.phase;
      }
      const scene = sceneOf(seg);
      return laneOrder(seg.song, scene).map((id) => playheadAt(scene, id, phase));
    },

    /** Forget history older than `before` (call now and then with heardTime minus a second). */
    prune(before) {
      while (segments.length > 1 && segments[1].start <= before) segments.shift();
    },

    /** Global beats since the last restart at time t, or null when paused or before the start. */
    phaseAt(t) {
      const i = segIndexAt(t);
      return i < 0 ? null : segments[i].pulse.phaseAt(t);
    },
  };

  return api;
}
