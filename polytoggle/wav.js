// polytoggle WAV export: encode rendered audio as a 16-bit PCM .wav file, with a LIST/INFO metadata chunk. Pure.

const ascii = (str) => String(str).replace(/[^\x20-\x7e]/g, '?'); // INFO text is read as plain ASCII by most players

/**
 * @param {Float32Array[]} channels one array per channel, equal length  @param {number} sampleRate
 * @param {Record<string,string>} [info] RIFF INFO fields by four-letter id, e.g. { INAM: 'my song', ICMT: '...' }
 */
export function encodeWav(channels, sampleRate, info = {}) {
  const n = channels[0].length;
  const ch = channels.length;
  const bytes = n * ch * 2;
  const fields = Object.entries(info).map(([id, value]) => {
    const text = ascii(value);
    const len = text.length + 1; // null-terminated
    return { id, text, len, padded: len + (len % 2) };
  });
  const listBytes = fields.length ? 12 + fields.reduce((a, f) => a + 8 + f.padded, 0) : 0;
  const buf = new ArrayBuffer(44 + bytes + listBytes);
  const v = new DataView(buf);
  const text = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + bytes + listBytes, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  if (fields.length) {
    text(o, 'LIST'); v.setUint32(o + 4, listBytes - 8, true); text(o + 8, 'INFO');
    o += 12;
    for (const f of fields) {
      text(o, f.id); v.setUint32(o + 4, f.len, true); text(o + 8, f.text); // the null byte and pad byte are already zero
      o += 8 + f.padded;
    }
  }
  return buf;
}

/** Longest export, in seconds (spec: capped at 10 minutes). */
export const MAX_EXPORT_SECONDS = 600;

/** Silence before the first note, so a player never clips the attack (seconds). */
export const LEAD_IN_SECONDS = 0.02;
/** Room after the loop's end for note release tails, then the whole file fades to silence over its last FADE_OUT_SECONDS. */
export const TAIL_SECONDS = 2;
export const FADE_OUT_SECONDS = 1;
/** A scene shorter than SHORT_CYCLE_SECONDS repeats whole cycles until the file's music is at least TARGET_SECONDS. */
export const SHORT_CYCLE_SECONDS = 30;
export const TARGET_SECONDS = 30;

/**
 * How a scene's cycle becomes a file: lead-in, whole loops, tail. A cycle of 30 s or more is one pass; a shorter one
 * repeats so the file ends on the loop point and runs at least 30 s. Pure.
 * @returns {{loops: number, bodySeconds: number, totalSeconds: number, cut: boolean}} `cut` is true when the 10-minute cap trimmed a single pass.
 */
export function exportPlan(cycleSeconds) {
  const loops = cycleSeconds >= SHORT_CYCLE_SECONDS ? 1 : Math.ceil(TARGET_SECONDS / cycleSeconds);
  const full = cycleSeconds * loops;
  const bodySeconds = Math.min(full, MAX_EXPORT_SECONDS);
  return { loops, bodySeconds, totalSeconds: LEAD_IN_SECONDS + bodySeconds + TAIL_SECONDS, cut: full > MAX_EXPORT_SECONDS };
}

/** Fade every channel to silence over the last `seconds` (raised-cosine, so it has no corner), in place. */
export function fadeOut(channels, sampleRate, seconds = FADE_OUT_SECONDS) {
  for (const data of channels) {
    const n = Math.min(data.length, Math.round(seconds * sampleRate));
    const start = data.length - n;
    for (let i = 0; i < n; i++) data[start + i] *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / n));
  }
}

/** Scale so the loudest sample sits at `peakDb` dBFS (default -1), in place. Even a very quiet scene: only true silence is left alone. */
export function peakNormalize(channels, peakDb = -1) {
  let peak = 0;
  for (const data of channels) for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak <= 0) return 1;
  const gain = 10 ** (peakDb / 20) / peak;
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= gain;
  return gain;
}

/** `<song>-scene-<n>-<mode>-<bpm>bpm.wav` from the song's file name (".polytoggle"); the tempo is always last. */
export function wavFileName(songFile, sceneNumber, mode, bpm) {
  return songFile.replace(/\.polytoggle$/, '') + `-scene-${sceneNumber}-${mode}-${bpm}bpm.wav`;
}

/** The INFO fields: title, a readable summary of how the file was made, software and date. */
export function wavInfo({ songName, sceneNumber, mode, bpm, cycleSeconds, loops, soloed = [], date = new Date() }) {
  const parts = [
    `scene ${sceneNumber}`, `${bpm} BPM`, mode, `cycle ${cycleSeconds.toFixed(1)} s x ${loops} ${loops === 1 ? 'loop' : 'loops'}`,
    ...(soloed.length ? [`solo: ${soloed.join(', ')}`] : []),
    `exported ${date.toISOString().slice(0, 10)}`, 'created with polyrhythmic.design',
  ];
  return { INAM: songName, ICMT: parts.join(' | '), ISFT: 'polytoggle (polyrhythmic.design)', ICRD: date.toISOString().slice(0, 10) };
}
