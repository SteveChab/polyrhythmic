import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import * as s from '../toggle/song.js';
import { encodeShare, decodeShare, isShareHash, MAX_ENCODED, MAX_JSON_BYTES } from '../toggle/share.js';

const fixture = readFileSync(new URL('./fixtures/song-v1.polytoggle', import.meta.url), 'utf8');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hashOf = (text) => `#s=${b64url(deflateRawSync(Buffer.from(text)))}`;
const refuses = (hash, re) => assert.rejects(decodeShare(hash), (e) => e instanceof s.SongError && re.test(e.message));

// A full song: 8 lanes, 20 beats, a note on every beat of every scene, odd tunings (a worst case for size).
function fullSong() {
  let song = s.createSong({ name: 'Full', bpm: 113.13 });
  const ids = ['kick', 'snare', 'closed-hat', 'saw-bass', 'sine', 'triangle', 'ride', 'clap'];
  ids.forEach((id) => { song = s.addLane(song, id); });
  const doc = structuredClone(song);
  for (const sc of doc.scenes) {
    for (const lane of doc.lanes) {
      const st = sc.lanes[lane.id];
      st.beats = 20;
      st.tuning = '31-edo';
      st.notes = Array.from({ length: 20 }, (_, beat) => ({ beat, length: 1, cents: -2905.263157894737 + beat * 38.7096774193548, noisePct: 13.37, volumeDb: -3.3 }));
    }
  }
  return s.validateSong(doc);
}

test('a song survives a round trip through a link', async () => {
  const song = s.loadSong(fixture);
  const hash = await encodeShare(song);
  assert.match(hash, /^#s=[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeShare(hash), song);
});

test('the same song always makes the same link', async () => {
  const song = s.loadSong(fixture);
  assert.equal(await encodeShare(song), await encodeShare(song));
});

test('a link is much shorter than the file', async () => {
  const hash = await encodeShare(s.loadSong(fixture));
  assert.ok(hash.length < fixture.length / 2, `${hash.length} vs ${fixture.length}`);
});

test('the largest possible song still fits in a link', async () => {
  const song = fullSong();
  const hash = await encodeShare(song);
  assert.ok(hash.length - 3 <= MAX_ENCODED, `payload is ${hash.length - 3} characters`);
  assert.deepEqual(await decodeShare(hash), song);
});

test('even a song of 800 random long decimals fits', async () => {
  const doc = structuredClone(fullSong());
  for (const sc of doc.scenes) for (const l of doc.lanes) for (const n of sc.lanes[l.id].notes) {
    n.cents = -3000 + Math.random() * 4000; n.noisePct = Math.random() * 100; n.volumeDb = -Math.random() * 40;
  }
  const song = s.validateSong(doc);
  const hash = await encodeShare(song);
  console.log('worst-case payload characters:', hash.length - 3);
  assert.ok(hash.length - 3 <= MAX_ENCODED);
  assert.deepEqual(await decodeShare(hash), song);
});

test('isShareHash recognizes share hashes only', () => {
  assert.ok(isShareHash('#s=abc'));
  assert.ok(!isShareHash(''));
  assert.ok(!isShareHash('#scene-2'));
  assert.ok(!isShareHash(undefined));
});

test('other hashes and junk are refused', async () => {
  await refuses('', /isn’t a polytoggle song link/);
  await refuses('#scene=2', /isn’t a polytoggle song link/);
  await refuses('#s=', /isn’t a polytoggle song link/);
  await refuses('#s=abc def', /isn’t a polytoggle song link/);
  await refuses('#s=<script>alert(1)</script>', /isn’t a polytoggle song link/);
  await refuses('#s=abc%20', /isn’t a polytoggle song link/);
});

test('damaged payloads are refused with a plain message', async () => {
  await refuses('#s=A', /damaged/); // impossible base64 length
  await refuses('#s=aGVsbG8gd29ybGQ', /damaged/); // valid base64, not deflate
  const good = await encodeShare(s.loadSong(fixture));
  await refuses(good.slice(0, good.length - 12), /damaged|isn.t a polytoggle song|no valid version/); // truncated
});

test('a link whose contents are not a song is refused', async () => {
  await refuses(hashOf('not json'), /isn.t a polytoggle song/);
  await refuses(hashOf('{"format":"other"}'), /isn.t a polytoggle song/);
  await refuses(hashOf('[]'), /isn.t a polytoggle song/);
  await refuses(hashOf('"<img src=x onerror=alert(1)>"'), /isn.t a polytoggle song/);
});

test('invalid UTF-8 is refused', async () => {
  const bad = `#s=${b64url(deflateRawSync(Buffer.from([0xff, 0xfe, 0x7b, 0x7d])))}`;
  await refuses(bad, /damaged/);
});

test('a song from a newer version is refused, not opened partly', async () => {
  const doc = JSON.parse(fixture);
  doc.version = s.CURRENT_VERSION + 1;
  await refuses(hashOf(JSON.stringify(doc)), /newer version/);
});

test('a decompression bomb is stopped by the size cap', async () => {
  const bomb = hashOf(`{"format":"polytoggle","pad":"${'a'.repeat(MAX_JSON_BYTES * 8)}"}`);
  assert.ok(bomb.length < 4000, 'the payload itself is small');
  await refuses(bomb, /too big/);
});

test('an over-long link is refused before it is decoded', async () => {
  await refuses(`#s=${'A'.repeat(MAX_ENCODED + 1)}`, /too long/);
});

test('validation still applies: bad values and unknown fields', async () => {
  const doc = JSON.parse(fixture);
  doc.bpm = 9000;
  await refuses(hashOf(JSON.stringify(doc)), /BPM/);

  const extra = JSON.parse(fixture);
  extra.evil = '<script>alert(1)</script>';
  extra.lanes[0].onclick = 'alert(1)';
  extra.scenes[0].lanes.k7f2.notes[0].url = 'javascript:alert(1)';
  const song = await decodeShare(hashOf(JSON.stringify(extra)));
  assert.equal('evil' in song, false);
  assert.equal('onclick' in song.lanes[0], false);
  assert.equal('url' in song.scenes[0].lanes.k7f2.notes[0], false);
});

test('a lane id that would poison an object is refused', async () => {
  for (const id of ['__proto__', 'constructor', 'a b', '<b>', 'x'.repeat(17), '']) {
    const doc = JSON.parse(fixture);
    const old = doc.lanes[0].id;
    doc.lanes[0].id = id;
    for (const sc of doc.scenes) {
      sc.lanes = Object.fromEntries(Object.entries(sc.lanes).map(([k, v]) => [k === old ? id : k, v]));
    }
    const text = JSON.stringify(doc).replace('"id":"__proto__"', '"id":"__proto__"');
    // JSON.stringify drops a "__proto__" own key on the object, so build that case by hand.
    const raw = id === '__proto__' ? fixture.replaceAll(old, '__proto__') : text;
    if (id === 'constructor') {
      // "constructor" is a harmless own key; it must still load, and must not shadow anything.
      assert.doesNotThrow(() => s.loadSong(text));
      continue;
    }
    await refuses(hashOf(raw), /id of 1 to 16|Two lanes|lane that doesn't exist/);
  }
});

test('nothing in a song can reach Object.prototype', async () => {
  const raw = fixture.replace('"tuning": "12-edo"', '"tuning": "12-edo", "__proto__": {"polluted": true}');
  const song = await decodeShare(hashOf(raw));
  assert.equal({}.polluted, undefined);
  assert.equal(song.polluted, undefined);
});

test('a saved v1 link always opens (backwards compatibility)', async () => {
  // tests/fixtures/share-v1.txt was made once and must never be regenerated. When the song format moves
  // to version 2, this link must still open (through the migration) and a new share-v2.txt joins it.
  const link = readFileSync(new URL('./fixtures/share-v1.txt', import.meta.url), 'utf8').trim();
  assert.deepEqual(await decodeShare(link), s.loadSong(fixture));
});
