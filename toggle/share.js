// polytoggle share links: a whole song in the URL hash, "#s=<payload>". No backend: the hash never
// leaves the browser. The payload is the song document as minified JSON, deflated (raw) and
// base64url-encoded. Pure but for the platform's CompressionStream; no DOM. Spec: polytoggle-file-format.md,
// "Share links".
//
// Safety: a link is untrusted input, exactly like a file from Import. It is size-capped before and during
// decompression (so a tiny payload can't inflate to gigabytes), and the result goes through loadSong, which
// validates every field and copies only known ones. Nothing in a link is ever run, rendered as HTML or used
// as a URL.

import { loadSong, SongError } from './song.js';

export const HASH_KEY = 's';
export const MAX_ENCODED = 100000; // characters after "#s=": the longest link the app makes or opens
export const MAX_JSON_BYTES = 262144; // the longest song document a link may inflate to (256 KB)

const HASH_RE = /^#s=([A-Za-z0-9_-]+)$/;

const toBase64Url = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function fromBase64Url(text) {
  if (text.length % 4 === 1) throw new SongError('This link is damaged.');
  let bin;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw new SongError('This link is damaged.');
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream, maxOut = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxOut) {
      reader.cancel().catch(() => {});
      throw new SongError('This link is too big to be a polytoggle song.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Is this location hash a share link (even a broken one)? */
export const isShareHash = (hash) => typeof hash === 'string' && hash.startsWith(`#${HASH_KEY}=`);

/**
 * The hash for a song, "#s=…". Throws SongError when it would pass MAX_ENCODED (export a file instead).
 * Notes are written in the song's own order, so the same song always makes the same link.
 */
export async function encodeShare(song) {
  const json = new TextEncoder().encode(JSON.stringify(song));
  const packed = await pipe(json, new CompressionStream('deflate-raw'));
  const payload = toBase64Url(packed);
  if (payload.length > MAX_ENCODED) throw new SongError('This song is too big to share as a link. Export a song file instead.');
  return `#${HASH_KEY}=${payload}`;
}

/** Open a song from a share hash. Returns a clean song or throws SongError with a plain message. */
export async function decodeShare(hash) {
  const m = HASH_RE.exec(typeof hash === 'string' ? hash : '');
  if (!m) throw new SongError('This link isn’t a polytoggle song link.');
  if (m[1].length > MAX_ENCODED) throw new SongError('This link is too long to be a polytoggle song.');
  const packed = fromBase64Url(m[1]);
  let json;
  try {
    json = await pipe(packed, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
  } catch (err) {
    if (err instanceof SongError) throw err;
    throw new SongError('This link is damaged.');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(json);
  } catch {
    throw new SongError('This link is damaged.');
  }
  return loadSong(text);
}
