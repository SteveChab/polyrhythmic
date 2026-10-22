// polytoggle storage: songs in the browser, the autosaved working song, and the Recent list.
// Pure but for the `storage` object passed in (window.localStorage in the app, a Map-like fake in
// tests). Spec: polytoggle-file-format.md, "Browser storage" and "Autosave".

import { loadSong, serializeSong, SongError } from './song.js';

export const KEYS = Object.freeze({
  song: (id) => `polytoggle:song:${id}`,
  recent: 'polytoggle:recent',
  working: 'polytoggle:working',
  zoom: 'polytoggle:zoom',
  instrumentsCollapsed: 'polytoggle:instruments-collapsed',
  panelCollapsed: 'polytoggle:panel-collapsed',
  fullscreen: 'polytoggle:fullscreen', // phones: 'off' once Full screen is turned off in the Menu
  seenSaveNotice: 'polytoggle:seen-save-notice',
  hint: 'polytoggle:hint', // Poly's first-visit note: tap, play, then done
  seenConfirm: (name) => `polytoggle:seen-confirm:${name}`, // a confirmation is shown once, then never again
});

export const RECENT_MAX = 10;

export function newSongId(rand = Math.random) {
  let id = '';
  for (let i = 0; i < 10; i++) id += Math.floor(rand() * 36).toString(36);
  return id;
}

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Write; false when the browser refuses (private mode, quota). */
function write(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// ---------- Working song (autosave) ----------

/** The song on screen, plus the id of the saved song it came from (or null). */
export function saveWorking(storage, song, songId) {
  return write(storage, KEYS.working, JSON.stringify({ songId, song }));
}

/** The autosaved song, or null if there is none or it can't be opened. */
export function loadWorking(storage) {
  const text = read(storage, KEYS.working);
  if (!text) return null;
  try {
    const { songId, song } = JSON.parse(text);
    return { songId: typeof songId === 'string' ? songId : null, song: loadSong(song) };
  } catch {
    return null;
  }
}

// ---------- Saved songs and Recent ----------

export function listRecent(storage) {
  try {
    const list = JSON.parse(read(storage, KEYS.recent) ?? '[]');
    return Array.isArray(list)
      ? list.filter((r) => r && typeof r.songId === 'string' && typeof r.name === 'string' && typeof r.savedAt === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Save the song under `songId` (a new id if null) and move it to the top of Recent. Returns the id, or null. */
export function saveSong(storage, song, songId = null, now = new Date(), rand = Math.random) {
  const id = songId ?? newSongId(rand);
  if (!write(storage, KEYS.song(id), serializeSong(song))) return null;
  const rest = listRecent(storage).filter((r) => r.songId !== id);
  const recent = [{ songId: id, name: song.name, savedAt: now.toISOString() }, ...rest].slice(0, RECENT_MAX);
  write(storage, KEYS.recent, JSON.stringify(recent));
  return id;
}

/** A saved song, opened through the same checks as a file. Throws SongError if it can't be. */
export function openSong(storage, songId) {
  const text = read(storage, KEYS.song(songId));
  if (text === null) throw new SongError('That song is no longer saved in this browser.');
  return loadSong(text);
}

/** True when the song on screen differs from what was last saved (or was never saved and has content). */
export function hasUnsavedChanges(storage, song, songId, isBlank) {
  if (songId === null) return !isBlank(song);
  const text = read(storage, KEYS.song(songId));
  return text === null || text !== serializeSong(song);
}

// ---------- Files ----------

/** "My song" -> "my-song.polytoggle". */
export function fileNameFor(song) {
  const slug = song.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'song'}.polytoggle`;
}
