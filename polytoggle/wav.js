// polytoggle WAV export: encode rendered audio as a 16-bit PCM .wav file. Pure.

/** @param {Float32Array[]} channels one array per channel, equal length  @param {number} sampleRate */
export function encodeWav(channels, sampleRate) {
  const n = channels[0].length;
  const ch = channels.length;
  const bytes = n * ch * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const text = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
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
  return buf;
}

/** Longest export, in seconds (spec: capped at 10 minutes). */
export const MAX_EXPORT_SECONDS = 600;
