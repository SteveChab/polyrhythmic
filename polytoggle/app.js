// polytoggle app: DOM and wiring. Logic lives in song.js, sequencer.js, readout.js, ../shared/history.js and
// store.js; sound in sound.js. Sound is booked ahead on the audio clock (clock.js); the screen
// follows it, moving each lane's playhead bar once per frame.

import * as S from './song.js';
import { createSequencer } from './sequencer.js';
import { createSound } from './sound.js';
import { createHistory } from '../shared/history.js';
import { createConfirmOnce } from '../shared/confirm-once.js';
import { bindShortcuts } from '../shared/shortcuts.js';
import * as store from './store.js';
import * as R from './readout.js';
import { encodeWav, MAX_EXPORT_SECONDS } from './wav.js';
import { INFO, SHORTCUTS } from './info.js';
import { TUNINGS, getTuning } from '../shared/tuning.js';
import { noteColor } from '../shared/color.js';
import { getAudioContext, unlockAudio, heardTime, createFrameLoop, createScheduler } from '../shared/clock.js';
import { bindPlayPause } from '../shared/ui.js';
import { isPhone, onPhoneChange } from '../shared/phone.js';
import { setupPhone } from './phone.js';
import { createNudge } from './nudge.js';
import { canFullscreen, isFullscreen, enterFullscreen, exitFullscreen, onFullscreenChange } from '../shared/fullscreen.js';

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

const icon = (name) => h('span', { class: 'pr-icon', 'aria-hidden': 'true', text: name });
const MINUS = '−';
const dbText = (db) => (db <= S.DB_MIN ? `${MINUS}∞ dB` : db === 0 ? '0 dB' : `${MINUS}${Math.abs(Math.round(db * 10) / 10)} dB`);
const { posToDb, dbToPos } = S;

// ---------- Storage ----------

const storage = (() => {
  try {
    localStorage.setItem('polytoggle:test', '1');
    localStorage.removeItem('polytoggle:test');
    return localStorage;
  } catch {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
})();
const pref = (key, fallback) => {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const setPref = (key, value) => { try { storage.setItem(key, JSON.stringify(value)); } catch { /* keep going */ } };

// ---------- State ----------

/** A first visit opens four empty lanes ready to tap (spec, Saving and files). Lanes approved for now (Oct 21). */
const STARTER_LANES = [['kick', 4], ['snare', 8], ['closed-hat', 6], ['saw-bass', 5]];
function starterKit() {
  let s = S.createSong();
  for (const [id, beats] of STARTER_LANES) {
    s = S.addLane(s, id);
    const lane = s.lanes.at(-1);
    for (let i = 0; i < S.SCENE_COUNT; i++) s = S.setBeats(s, i, lane.id, beats);
  }
  return s;
}

const working = store.loadWorking(storage);
const firstVisit = !working && store.listRecent(storage).length === 0;
let song = working?.song ?? (firstVisit ? starterKit() : S.createSong());
let songId = working?.songId ?? null;
let scene = 0;
let history = createHistory(song, 0);
let sel = { lane: null, beat: null }; // beat: start beat of the selected note
let cursor = { lane: 0, beat: 0 }; // beat -1 is the lane header
let noteClipboard = null;
let sceneClipboard = null;
const ZOOM_MIN = 24;
const ZOOM_MAX = 88;
let zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(pref(store.KEYS.zoom, ZOOM_MIN)) || ZOOM_MIN));
let hasPlayed = false;
let eraseMode = false; // phones: with nothing selected, Erase turns this on; taps then remove notes and lanes
let phoneTab = 'note'; // phones: which tab the settings drawer shows
let phone = null; // the phone's rail and drawers (phone.js), set up at the start


const sc = () => song.scenes[scene];
const laneAt = (i) => song.lanes[i];
const laneIdx = (id) => song.lanes.findIndex((l) => l.id === id);
const settings = (id) => sc().lanes[id];
const noteAtBeat = (id, beat) => settings(id).notes.find((n) => beat >= n.beat && beat < n.beat + n.length) ?? null;
/** The starter kit, still untouched: no notes, the same four lanes and beat counts. */
const isStarter = (s) => s.lanes.length === STARTER_LANES.length && s.scenes.every(S.sceneIsEmpty)
  && s.lanes.every((l, i) => l.instrument === STARTER_LANES[i][0] && s.scenes.every((x) => x.lanes[l.id].beats === STARTER_LANES[i][1]));
const isBlank = (s) => (s.lanes.length === 0 || isStarter(s)) && s.name === S.DEFAULT_NAME;

// ---------- Audio and transport ----------

let ctx = null;
let sound = null;
const seq = createSequencer({ song, sceneIndex: 0 });
let scheduler = null;

let audioReady = null;
/** One sound engine and one scheduler, made on the first gesture. Concurrent callers share them. */
function ensureAudio() {
  audioReady ??= unlockAudio().then((c) => {
    ctx = c;
    sound = createSound(ctx);
    scheduler = createScheduler({
      getTime: () => ctx.currentTime,
      onWindow(from, to) { for (const e of seq.book(from, to)) sound.play(e); },
    });
    applyMix();
    return sound;
  });
  return audioReady.then(async (s) => {
    if (ctx.state !== 'running') await ctx.resume();
    return s;
  });
}

const playing = () => !!scheduler?.running;
/** The audio time up to which everything is booked: edits apply from here. */
const at = () => (playing() ? scheduler.cursor : 0);

function applyMix() {
  if (!sound) return;
  sound.setMaster(song.masterDb);
  for (const lane of song.lanes) sound.setLane(lane.id, settings(lane.id));
}

const frames = createFrameLoop({ getTime: () => 0, onFrame: () => drawHeads() });

const transport = bindPlayPause($('play'), {
  async onPlay() {
    await ensureAudio();
    const start = ctx.currentTime + 0.05;
    applyMix();
    seq.play(start);
    scheduler.start(start);
    hasPlayed = true;
    if (song.scenes.some((x) => !S.sceneIsEmpty(x))) setHint('done');
    frames.start();
  },
  onPause() {
    if (!scheduler) return;
    scheduler.stop();
    seq.pause(ctx.currentTime);
    sound.silence();
    frames.stop();
    drawHeads();
  },
});

$('restart').addEventListener('click', () => {
  seq.restart(at());
  hasPlayed = true;
  drawHeads();
  announce('Restarted from beat 1');
});

/** Tell the sequencer the song changed. `restart` for a scene switch, the polytoggle, or a new song. */
function syncSequencer(restart, whole = false) {
  if (restart) seq.restart(at(), { song, sceneIndex: whole ? 0 : scene });
  else seq.setSong(song, at());
}

// ---------- Editing ----------

/** Make `next` the song. Returns true if anything changed. */
function commit(next, { key = null, restart = false, stage = true } = {}) {
  if (!next || next === song) return false;
  song = next;
  history.push(song, scene, key);
  changed({ restart, stage });
  return true;
}

function changed({ restart = false, stage = true, whole = false } = {}) {
  fixSelection();
  syncSequencer(restart, whole);
  applyMix();
  renderTop();
  if (stage) renderStage();
  renderPanel();
  scheduleAutosave();
}

function fixSelection() {
  if (sel.lane !== null && laneIdx(sel.lane) < 0) sel = { lane: null, beat: null };
  if (sel.beat !== null && !(sel.lane !== null && settings(sel.lane).notes.some((n) => n.beat === sel.beat))) sel.beat = null;
  cursor.lane = Math.max(0, Math.min(song.lanes.length - 1, cursor.lane));
  const lane = laneAt(cursor.lane);
  if (lane) cursor.beat = Math.min(cursor.beat, settings(lane.id).beats - 1);
}

function replaceSong(next, id) {
  song = next;
  songId = id;
  scene = 0;
  history = createHistory(song, 0);
  sel = { lane: null, beat: null };
  cursor = { lane: 0, beat: 0 };
  changed({ restart: true, whole: true });
}

function setScene(i, { silent = false } = {}) {
  if (i === scene && !silent) return;
  scene = i;
  sel = { lane: null, beat: null };
  cursor = { lane: Math.min(cursor.lane, Math.max(0, song.lanes.length - 1)), beat: 0 };
  syncSequencer(true);
  applyMix();
  renderTop();
  renderStage();
  renderPanel();
  announce(`Scene ${i + 1}${S.sceneIsEmpty(sc()) ? ', empty' : ''}`);
}

function undo() {
  const r = history.undo();
  if (!r) return;
  applyHistory(r);
  announce('Undone');
}
function redo() {
  const r = history.redo();
  if (!r) return;
  applyHistory(r);
  announce('Redone');
}
function applyHistory({ song: next, scene: s }) {
  song = next;
  const switching = s !== scene;
  scene = s;
  changed({ restart: switching });
}

// ---------- Announcements, dialogs ----------

function announce(msg) {
  const live = $('live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 20);
}

const dialog = $('dialog');
/** Ask something. Resolves with true / the typed text, or null if cancelled. */
function ask({ title, text = '', ok = 'OK', cancel = 'Cancel', input = null }) {
  return new Promise((resolve) => {
    $('dialog-title').textContent = title;
    $('dialog-text').textContent = text;
    $('dialog-text').hidden = !text;
    const field = $('dialog-input');
    field.hidden = input === null;
    if (input !== null) field.value = input;
    $('dialog-cancel').hidden = cancel === null;
    $('dialog-ok').textContent = ok;
    const ac = new AbortController();
    const done = (v) => { ac.abort(); if (dialog.open) dialog.close(); resolve(v); };
    $('dialog-form').addEventListener('submit', (e) => { e.preventDefault(); done(input !== null ? field.value : true); }, { signal: ac.signal });
    $('dialog-cancel').addEventListener('click', () => done(null), { signal: ac.signal });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }, { signal: ac.signal });
    dialog.showModal();
    (input !== null ? field : $('dialog-ok')).focus();
    if (input !== null) field.select();
  });
}

const confirmOnce = createConfirmOnce({ prefix: 'polytoggle', ask, storage });

// ---------- Info area ----------


function showInfo(title, text) {
  $('info-title').textContent = title;
  $('info-text').textContent = text;
}
function infoFor(el) {
  const target = el.closest?.('[data-info]');
  if (!target) return;
  const entry = INFO[target.dataset.info];
  if (entry) showInfo(...entry);
}
document.addEventListener('mouseover', (e) => infoFor(e.target));
document.addEventListener('focusin', (e) => infoFor(e.target));
showInfo(...INFO.start);

// The Info box is as tall as the longest microcopy, so no entry ever clips and nothing moves when it changes.
let infoHeight = 106;
function fitInfoHeight() {
  const info = $('info');
  if (!info.offsetParent) return; // the sidebar is folded; keep the last measurement
  const keep = [$('info-title').textContent, $('info-text').textContent];
  info.style.height = 'auto';
  info.style.flexBasis = 'auto';
  let tallest = 0;
  for (const entry of Object.values(INFO)) { showInfo(...entry); tallest = Math.max(tallest, info.offsetHeight); }
  info.style.height = '';
  info.style.flexBasis = '';
  showInfo(...keep);
  infoHeight = Math.max(106, Math.ceil(tallest));
  document.documentElement.style.setProperty('--dock-h', `${infoHeight}px`);
}
document.fonts?.ready.then(fitInfoHeight);
addEventListener('resize', fitInfoHeight);


// ---------- Top bar ----------

const sceneButtons = [];
for (let i = 0; i < S.SCENE_COUNT; i++) {
  const b = h('button', {
    class: 'pr-scene', type: 'button', role: 'tab', 'data-info': 'scene', draggable: 'true',
    'aria-label': `Scene ${i + 1}`, text: String(i + 1),
  });
  b.addEventListener('click', () => setScene(i));
  b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-scene', String(i)); e.dataTransfer.effectAllowed = 'copyMove'; });
  b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-scene')) { e.preventDefault(); b.classList.add('is-drop'); } });
  b.addEventListener('dragleave', () => b.classList.remove('is-drop'));
  b.addEventListener('drop', (e) => {
    e.preventDefault();
    b.classList.remove('is-drop');
    const from = Number(e.dataTransfer.getData('text/x-scene'));
    if (e.altKey) copySceneTo(from, i);
    else moveSceneTo(from, i);
  });
  b.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = i + (e.key === 'ArrowRight' ? 1 : -1);
      if (to >= 0 && to < S.SCENE_COUNT) { moveSceneTo(i, to); sceneButtons[to].focus(); }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const to = (i + (e.key === 'ArrowRight' ? 1 : S.SCENE_COUNT - 1)) % S.SCENE_COUNT;
      sceneButtons[to].focus();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      clearSceneAt(i);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      sceneClipboard = i;
      announce(`Copied scene ${i + 1}`);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && sceneClipboard !== null) {
      e.preventDefault();
      copySceneTo(sceneClipboard, i);
    }
  });
  sceneButtons.push(b);
  $('scenes').append(b);
}

async function copySceneTo(from, to) {
  if (from === to || Number.isNaN(from)) return;
  if (!S.sceneIsEmpty(song.scenes[to])) {
    const yes = await confirmOnce('replace-scene', { title: `Replace scene ${to + 1}?`, text: `Scene ${to + 1} has notes. Copying scene ${from + 1} over it replaces them.`, ok: 'Replace' });
    if (!yes) return;
  }
  scene = to;
  sel = { lane: null, beat: null };
  if (commit(S.copyScene(song, from, to), { restart: true })) announce(`Copied scene ${from + 1} to scene ${to + 1}`);
}

async function clearSceneAt(i) {
  const yes = await confirmOnce('clear-scene', { title: `Clear scene ${i + 1}?`, text: `This removes every note and lane setting in scene ${i + 1}. The other scenes are not touched.`, ok: 'Clear scene' });
  if (!yes) return;
  scene = i;
  sel = { lane: null, beat: null };
  if (commit(S.clearScene(song, i), { restart: true })) announce(`Cleared scene ${i + 1}`);
}

function duplicateScene(i) {
  const to = S.nextEmptyScene(song, i);
  if (to < 0) return;
  scene = to;
  sel = { lane: null, beat: null };
  if (commit(S.copyScene(song, i, to), { restart: true })) announce(`Duplicated scene ${i + 1} to scene ${to + 1}`);
}

// The scene menu: the keyboard and touch route to duplicate and clear a scene.
const closeSceneMenu = menu('scene-menu-btn', 'scene-menu');
$('scene-menu-btn').addEventListener('click', () => {
  const m = $('scene-menu');
  const to = S.nextEmptyScene(song, scene);
  const empty = S.sceneIsEmpty(song.scenes[scene]);
  const item = (label, meta, onclick, disabled = false) => h('button', { class: 'pr-menu-item pr-menu-item--stacked', type: 'button', role: 'menuitem', disabled, onclick: () => { closeSceneMenu(); onclick(); } }, h('span', { text: label }), h('span', { class: 'pr-menu-item__meta', text: meta }));
  m.replaceChildren(
    item('Duplicate scene', empty ? 'Scene is empty' : to < 0 ? 'No empty scene to copy into' : `Copy scene ${scene + 1} into scene ${to + 1}`, () => duplicateScene(scene), empty || to < 0),
    item('Clear scene', `Remove everything in scene ${scene + 1}`, () => clearSceneAt(scene)),
  );
  if (!m.hidden) m.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
});

function moveSceneTo(from, to) {
  if (from === to || Number.isNaN(from)) return;
  const wasPlaying = scene;
  const next = S.moveScene(song, from, to);
  if (!next) return;
  // The tab you were on moves with its scene.
  const follow = wasPlaying === from ? to : wasPlaying > from && wasPlaying <= to ? wasPlaying - 1 : wasPlaying < from && wasPlaying >= to ? wasPlaying + 1 : wasPlaying;
  scene = follow;
  commit(next, { restart: true });
  announce(`Moved scene ${from + 1} to position ${to + 1}`);
}

function renderTop() {
  const bpm = $('bpm');
  if (document.activeElement !== bpm) bpm.value = String(song.bpm);
  const m = $('master');
  m.value = String(dbToPos(song.masterDb));
  m.setAttribute('aria-valuetext', dbText(song.masterDb));
  const poly = sc().polytoggle === 'polyrhythm';
  $('polytoggle').setAttribute('aria-checked', String(poly));
  $('loop-readout').textContent = R.loopReadout(sc(), song.bpm);
  $('loop-readout').setAttribute('aria-label', `Loop length: ${R.loopReadout(sc(), song.bpm)}`);
  $('undo').disabled = !history.canUndo;
  $('redo').disabled = !history.canRedo;
  sceneButtons.forEach((b, i) => {
    b.setAttribute('aria-selected', String(i === scene));
    b.tabIndex = i === scene ? 0 : -1;
    b.classList.toggle('is-empty', S.sceneIsEmpty(song.scenes[i]));
    b.setAttribute('aria-label', `Scene ${i + 1}${S.sceneIsEmpty(song.scenes[i]) ? ', empty' : ''}`);
  });
  $('zoom').value = String(zoom);
  $('song-name-text').textContent = song.name;
  $('song-name').setAttribute('aria-label', `Song name: ${song.name}. Click to rename`);
  document.title = `${song.name} · polytoggle · polyrhythmic.design`;
  phone?.render();
}

// Up and down move whole BPM; typing still takes decimals (113.13).
$('bpm').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const v = Number(e.target.value);
  if (!Number.isFinite(v)) return;
  const next = e.key === 'ArrowUp' ? Math.floor(v) + 1 : Math.ceil(v) - 1;
  e.target.value = String(Math.max(S.BPM_MIN, Math.min(S.BPM_MAX, next)));
  e.target.dispatchEvent(new Event('change', { bubbles: true }));
});

$('bpm').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (!commit(S.setBpm(song, v), { key: 'bpm' })) renderTop();
  history.seal();
  e.target.value = String(song.bpm);
});
$('master').addEventListener('input', (e) => commit(S.setMasterDb(song, posToDb(Number(e.target.value))), { key: 'master', stage: false }));
$('master').addEventListener('change', () => history.seal());
$('polytoggle').addEventListener('click', () => {
  const next = sc().polytoggle === 'polyrhythm' ? 'polymeter' : 'polyrhythm';
  history.seal();
  commit(S.setPolytoggle(song, scene, next), { restart: true });
  announce(next === 'polyrhythm' ? 'Polyrhythm: all lanes loop together' : 'Polymeter: each lane loops on its own length');
});
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

function setZoom(z) {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z)));
  setPref(store.KEYS.zoom, zoom);
  $('zoom').value = String(zoom);
  $('lanes').style.setProperty('--zoom', String(zoom / ZOOM_MIN));
}
$('zoom').addEventListener('input', (e) => setZoom(Number(e.target.value)));
$('zoom-in').addEventListener('click', () => setZoom(zoom + 8));
$('zoom-out').addEventListener('click', () => setZoom(zoom - 8));

// ---------- Files ----------

async function confirmDiscard(what) {
  if (!store.hasUnsavedChanges(storage, song, songId, isBlank)) return true;
  return !!(await ask({ title: `${what}?`, text: 'This song has changes you haven’t saved. Continue and they are replaced. (Your work is autosaved, but only the song on screen.)', ok: what }));
}

$('new').addEventListener('click', async () => {
  if (!(await confirmDiscard('Start a new song'))) return;
  replaceSong(S.createSong(), null);
  announce('New song');
});

// The song name is plain text with a pencil; clicking it swaps in a text field. Enter or leaving the field saves, Esc cancels.
function editSongName() {
  const btn = $('song-name');
  const input = $('song-name-input');
  btn.hidden = true;
  input.hidden = false;
  input.value = song.name;
  input.focus();
  input.select();
}
function endSongNameEdit(save) {
  const btn = $('song-name');
  const input = $('song-name-input');
  if (input.hidden) return;
  const renamed = save ? S.setName(song, input.value) : null;
  input.hidden = true;
  btn.hidden = false;
  if (renamed && renamed.name !== song.name) { history.seal(); commit(renamed); }
  btn.focus();
}
$('song-name').addEventListener('click', editSongName);
$('song-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); endSongNameEdit(true); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endSongNameEdit(false); }
});
$('song-name-input').addEventListener('blur', () => endSongNameEdit(true));

async function doSave() {
  if (songId === null && song.name === S.DEFAULT_NAME) {
    const name = await ask({ title: 'Name this song', input: song.name, ok: 'Save' });
    if (name === null) return;
    const renamed = S.setName(song, name);
    if (renamed) commit(renamed);
  }
  if (!pref(store.KEYS.seenSaveNotice, false)) {
    await ask({ title: 'Songs live in this browser', text: 'Clearing your browser data deletes saved songs. Export makes a file copy to keep.', ok: 'Got it', cancel: null });
    setPref(store.KEYS.seenSaveNotice, true);
  }
  const id = store.saveSong(storage, song, songId);
  if (id === null) {
    await ask({ title: 'Couldn’t save', text: 'This browser wouldn’t store the song. Export a file instead.', ok: 'OK', cancel: null });
    return;
  }
  songId = id;
  store.saveWorking(storage, song, songId);
  announce(`Saved ${song.name}`);
}
$('save').addEventListener('click', doSave);

function menu(buttonId, menuId) {
  const btn = $(buttonId);
  const m = $(menuId);
  const close = () => { m.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = m.hidden;
    document.dispatchEvent(new Event('close-menus'));
    if (open) {
      m.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      m.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    }
  });
  m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { close(); btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  document.addEventListener('close-menus', close);
  document.addEventListener('click', (e) => { if (!m.hidden && !m.contains(e.target)) close(); });
  return close;
}
const closeOpen = menu('open', 'open-menu');
const closeExport = menu('export', 'export-menu');

/** The Open menu's entries: Recent songs, then Import. The phone's Menu shows the same list. */
function openEntries(close) {
  const recent = store.listRecent(storage);
  return [
    h('div', { class: 'pr-menu__heading pr-eyebrow', text: 'Recent' }),
    ...(recent.length
      ? recent.map((r) => h('button', {
        class: 'pr-menu-item pr-menu-item--stacked', type: 'button', role: 'menuitem',
        onclick: () => { close(); openSaved(r.songId); },
      }, h('span', { text: r.name }), h('span', { class: 'pr-menu-item__meta', text: new Date(r.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) })))
      : [h('button', { class: 'pr-menu-item', type: 'button', role: 'menuitem', disabled: true, text: 'No saved songs yet' })]),
    h('div', { class: 'pr-menu__heading pr-eyebrow pt-menu__rule', text: 'From your computer' }),
    h('button', { class: 'pr-menu-item', type: 'button', role: 'menuitem', onclick: () => { close(); $('import-file').click(); } }, 'Import a .polytoggle file…'),
  ];
}
$('open').addEventListener('click', () => {
  const m = $('open-menu');
  m.replaceChildren(...openEntries(closeOpen));
  if (!m.hidden) m.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
});

async function openSaved(id) {
  if (!(await confirmDiscard('Open another song'))) return;
  try {
    replaceSong(store.openSong(storage, id), id);
    announce(`Opened ${song.name}`);
  } catch (err) {
    await ask({ title: 'Couldn’t open that song', text: err.message, ok: 'OK', cancel: null });
  }
}

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const next = S.loadSong(await file.text());
    if (!(await confirmDiscard('Import this song'))) return;
    replaceSong(next, null);
    announce(`Imported ${song.name}`);
  } catch (err) {
    await ask({ title: 'Couldn’t open that file', text: err instanceof S.SongError ? err.message : 'This isn’t a polytoggle song.', ok: 'OK', cancel: null });
  }
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-song').addEventListener('click', () => {
  closeExport();
  download(new Blob([S.serializeSong(song)], { type: 'application/json' }), store.fileNameFor(song));
});

$('export-wav').addEventListener('click', async () => {
  closeExport();
  const beats = S.loopBeats(sc());
  if (!beats || S.sceneIsEmpty(sc())) {
    await ask({ title: 'Nothing to export', text: 'This scene has no notes yet.', ok: 'OK', cancel: null });
    return;
  }
  const full = S.beatsToSeconds(beats, song.bpm);
  const secs = Math.min(full, MAX_EXPORT_SECONDS);
  const rate = 44100;
  const tail = 1.5;
  const status = $('export-status');
  const fmt = (n) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
  status.textContent = `Rendering ${fmt(secs)} of audio…`;
  $('export').disabled = true;
  await new Promise((r) => setTimeout(r, 30)); // let the message paint before the heavy work
  try {
    const off = new OfflineAudioContext(2, Math.ceil((secs + tail) * rate), rate);
    const snd = createSound(off);
    snd.setMaster(song.masterDb, true);
    for (const lane of song.lanes) snd.setLane(lane.id, settings(lane.id), true);
    const sq = createSequencer({ song, sceneIndex: scene });
    sq.play(0);
    for (const e of sq.book(0, secs)) snd.play(e);
    const buf = await off.startRendering();
    const file = store.fileNameFor(song).replace(/\.polytoggle$/, `-scene-${scene + 1}.wav`);
    download(new Blob([encodeWav([buf.getChannelData(0), buf.getChannelData(1)], rate)], { type: 'audio/wav' }), file);
    status.textContent = full > secs ? `Saved ${file}, cut at 10 minutes` : `Saved ${file}`;
  } catch (err) {
    status.textContent = '';
    await ask({ title: 'Couldn’t export audio', text: 'This browser couldn’t render the scene.', ok: 'OK', cancel: null });
  } finally {
    $('export').disabled = false;
    setTimeout(() => { status.textContent = ''; }, 8000);
  }
});

// ---------- Autosave ----------

let autosaveTimer = 0;
function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  store.saveWorking(storage, song, songId);
}
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 1000);
}
addEventListener('pagehide', flushAutosave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(); });

// ---------- Instruments ----------

function renderInstruments() {
  const root = $('instruments');
  for (const [group, label] of [['drum', 'Drum'], ['synth', 'Synth']]) {
    const list = h('div', { class: 'pr-sidebar__group', role: 'group', 'aria-label': label }, h('p', { class: 'pr-eyebrow', text: label }));
    for (const inst of S.INSTRUMENTS.filter((i) => i.group === group)) {
      const c = noteColor(S.centsToHz(inst.cents), { saturation: 100 - inst.noisePct });
      const row = h('div', { class: 'pr-inst-row' });
      const b = h('button', { class: 'pr-inst', type: 'button', 'data-info': 'instrument', draggable: 'true', 'aria-label': `${inst.name}: add as a new lane` },
        h('span', { class: 'pr-swatch', style: `--swatch:${c.hex}`, 'aria-hidden': 'true' }),
        h('span', { class: 'pr-inst__name', text: inst.name }));
      b.addEventListener('click', async () => { await ensureAudio(); sound.preview(inst.id); });
      b.addEventListener('dblclick', () => addLane(inst.id));
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLane(inst.id); } });
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-instrument', inst.id); e.dataTransfer.effectAllowed = 'copy'; });
      // Touch screens have no double-click or Enter, so each instrument gets an add button (shown only there).
      const add = h('button', { class: 'pr-inst-add', type: 'button', 'data-info': 'instrument-add', 'aria-label': `Add ${inst.name} as a new lane` }, h('span', { class: 'pr-icon', 'aria-hidden': 'true', text: 'add' }));
      add.addEventListener('click', () => { addLane(inst.id); if (matchMedia('(max-width: 820px)').matches) setSidebar(true, false); }); // on a narrow screen, close the list so the new lane shows
      row.append(b, add);
      list.append(row);
    }
    root.append(list);
  }
}

function addLane(instrumentId) {
  if (song.lanes.length >= S.MAX_LANES) { announce('A song has up to 8 lanes'); return; }
  const next = S.addLane(song, instrumentId);
  if (!next) return;
  const lane = next.lanes.at(-1);
  history.seal();
  commit(next);
  // On a phone a new lane isn't selected, so the settings drawer stays shut and the stage keeps its width.
  sel = isPhone() ? { lane: null, beat: null } : { lane: lane.id, beat: null };
  cursor = { lane: next.lanes.length - 1, beat: 0 };
  renderStage();
  renderPanel();
  announce(`Added ${lane.name} lane`);
}

const stageEl = $('stage');
stageEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-instrument')) { e.preventDefault(); stageEl.classList.add('is-drop'); } });
stageEl.addEventListener('dragleave', () => stageEl.classList.remove('is-drop'));
stageEl.addEventListener('drop', (e) => {
  stageEl.classList.remove('is-drop');
  const id = e.dataTransfer.getData('text/x-instrument');
  if (id) { e.preventDefault(); addLane(id); }
});

function setSidebar(collapsed, remember = true) {
  $('sidebar').classList.toggle('is-collapsed', collapsed);
  $('sidebar-full').hidden = collapsed;
  $('sidebar-rail').hidden = !collapsed;
  $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  if (!collapsed) queueMicrotask(() => fitInfoHeight());
  if (remember) setPref(store.KEYS.instrumentsCollapsed, collapsed);
}
$('sidebar-toggle').addEventListener('click', () => { setSidebar(true); $('sidebar-rail').focus(); });
$('sidebar-rail').addEventListener('click', () => { setSidebar(false); $('sidebar-toggle').focus(); });

// ---------- The stage ----------

const heads = new Map(); // laneId -> { bar, cols }
let lastStep = new Map();

function noteStyle(n) {
  const c = noteColor(S.centsToHz(n.cents), { saturation: 100 - n.noisePct, db: n.volumeDb });
  return `--note-bg:${c.hex};--note-fg:${c.label}`;
}

function cellLabel(lane, ls, beat, note) {
  if (!note) return `${lane.name}, beat ${beat + 1}, empty`;
  const selected = sel.lane === lane.id && sel.beat === note.beat ? ', selected' : '';
  return `${lane.name}, beat ${beat + 1}, ${R.fullName(note.cents)}${note.length > 1 ? `, ${note.length} beats` : ''}${selected}`;
}

function renderStage() {
  const root = $('lanes');
  const focusedInStage = root.contains(document.activeElement) && document.activeElement.matches('[role="gridcell"]');
  const scn = sc();
  const poly = scn.polytoggle === 'polyrhythm';
  // Polymeter draws each lane once, as wide as the longest lane, not the (possibly enormous) loop where they realign.
  const total = poly ? S.loopBeats(scn) : Math.max(0, ...song.lanes.map((l) => scn.lanes[l.id].beats));
  root.style.setProperty('--zoom', String(zoom / ZOOM_MIN));
  root.style.setProperty('--total', String(total));
  root.replaceChildren();
  heads.clear();
  lastStep = new Map();
  $('empty-stage').hidden = song.lanes.length > 0;
  // Phones: a narrow row of beat numbers above the lanes, with a short loop readout over the headers.
  if (song.lanes.length) {
    root.append(h('div', { class: 'pt-beatrow pr-phone-only', 'aria-hidden': 'true' },
      h('span', { class: 'pt-beatrow__loop', text: R.loopShort(scn, song.bpm) }),
      h('span', { class: 'pt-beatrow__nums', style: `--cols:${total}` }, Array.from({ length: total }, (_, i) => h('span', { text: String(i + 1) })))));
  }

  song.lanes.forEach((lane, li) => {
    const ls = scn.lanes[lane.id];
    const cols = poly ? ls.beats : total;
    const selected = sel.lane === lane.id;
    const cells = h('div', { class: 'pt-cells', role: 'presentation', style: `--cols:${cols}` });

    for (let b = 0; b < ls.beats;) {
      const note = ls.notes.find((n) => n.beat === b);
      const isCursor = cursor.lane === li && cursor.beat === b;
      if (note) {
        const isSel = selected && sel.beat === note.beat;
        cells.append(h('div', {
          class: 'pr-note', role: 'gridcell', tabindex: isCursor ? '0' : '-1', 'data-info': 'note',
          'data-lane': lane.id, 'data-beat': String(b), 'aria-selected': String(isSel),
          'aria-label': cellLabel(lane, ls, b, note), style: `--span:${note.length};${noteStyle(note)}`,
        }, h('span', { class: 'pt-num', 'aria-hidden': 'true', text: String(b + 1) }), R.shortName(note.cents), h('span', { class: 'pr-note__grab', 'aria-hidden': 'true' })));
        b += note.length;
      } else {
        cells.append(h('div', {
          class: 'pt-cell', role: 'gridcell', tabindex: isCursor ? '0' : '-1', 'data-info': 'empty-beat',
          'data-lane': lane.id, 'data-beat': String(b), 'aria-label': cellLabel(lane, ls, b, null),
        }, h('span', { class: 'pt-num', 'aria-hidden': 'true', text: String(b + 1) })));
        b++;
      }
    }
    if (!poly) for (let b = ls.beats; b < total; b++) cells.append(h('div', { class: 'pt-cell pt-cell--ghost', 'aria-hidden': 'true' }));

    const bar = h('div', { class: 'pt-playhead__bar', hidden: true });
    heads.set(lane.id, { bar, cols });
    const track = h('div', { class: 'pt-track', 'data-lane': lane.id, 'data-cols': String(cols), style: `--total:${total};--cols:${cols}` },
      cells, h('div', { class: 'pt-playhead', 'aria-hidden': 'true' }, bar));

    root.append(h('div', { class: `pt-lane${selected ? ' is-selected' : ''}`, role: 'row', 'aria-label': lane.name }, laneHeader(lane, ls, selected, li), track));
  });

  if (focusedInStage) focusCursor();
  drawHeads(true);
}

function laneHeader(lane, ls, selected, li) {
  const inst = S.getInstrument(lane.instrument);
  const nameBtn = h('button', {
    class: 'pr-lane__name pr-hit', type: 'button', 'aria-pressed': String(selected), 'data-info': 'lane-name',
    'aria-label': `${lane.name}, ${inst.name} lane. Select; press F2 to rename`, text: lane.name,
  });
  nameBtn.addEventListener('click', () => { selectLane(lane.id); });
  nameBtn.addEventListener('dblclick', () => startRename(lane.id, nameBtn));
  nameBtn.addEventListener('focus', () => { cursor = { lane: li, beat: -1 }; });
  const dense = (label, info, attrs, onclick, content) => {
    const b = h('button', { class: 'pr-dense', type: 'button', 'data-info': info, 'aria-label': label, ...attrs }, content);
    b.addEventListener('click', onclick);
    return b;
  };
  const vol = h('input', { class: 'pr-range', type: 'range', min: '0', max: '100', step: '1', value: String(dbToPos(ls.volumeDb)), 'aria-label': `${lane.name} volume`, 'data-info': 'vol', 'aria-valuetext': dbText(ls.volumeDb) });
  const pan = h('input', { class: 'pr-range', type: 'range', min: '-100', max: '100', step: '1', value: String(Math.round(ls.pan * 100)), 'aria-label': `${lane.name} pan`, 'data-info': 'pan' });
  vol.addEventListener('input', () => { vol.setAttribute('aria-valuetext', dbText(posToDb(Number(vol.value)))); commit(S.setLaneSettings(song, scene, lane.id, { volumeDb: posToDb(Number(vol.value)) }), { key: `vol:${lane.id}`, stage: false }); });
  pan.addEventListener('input', () => commit(S.setLaneSettings(song, scene, lane.id, { pan: Number(pan.value) / 100 }), { key: `pan:${lane.id}`, stage: false }));
  for (const r of [vol, pan]) r.addEventListener('change', () => history.seal());
  // Phones: the whole header is one button (name, "DRUM · 4", MUTED). Its controls live in the Lane tab.
  const phoneHead = h('button', {
    class: 'pt-phonehead pr-phone-only', type: 'button', 'aria-pressed': String(selected),
    'aria-label': `${lane.name}, ${inst.name}, ${ls.beats} beats${ls.solo ? ', soloed' : ''}${ls.mute ? ', muted' : ''}. ${eraseMode ? 'Remove lane' : 'Select lane'}`,
  }, h('span', { class: 'pt-phonehead__name', text: lane.name }),
  h('span', { class: 'pt-phonehead__kind', text: `${inst.group} · ${ls.beats}` }),
  ls.solo || ls.mute ? h('span', { class: 'pt-phonehead__tags' },
    ls.solo ? h('span', { class: 'pt-phonehead__tag', text: 'Solo' }) : null,
    ls.mute ? h('span', { class: 'pt-phonehead__tag', text: 'Muted' }) : null) : null);
  phoneHead.addEventListener('click', () => {
    if (eraseMode) { sel = { lane: lane.id, beat: null }; deleteSelectedLane(); return; }
    if (sel.lane === lane.id && sel.beat === null) clearSelection(); else selectLane(lane.id);
  });
  return h('div', { class: 'pr-lane', role: 'rowheader' },
    phoneHead,
    h('div', { class: 'pr-lane__top pr-desk-only' }, nameBtn, h('span', { class: 'pr-lane__kind', text: inst.name })),
    h('div', { class: 'pr-lane__row pr-desk-only' },
      dense(`Solo ${lane.name}`, 'solo', { 'aria-pressed': String(ls.solo) }, () => toggleLane(lane.id, 'solo'), 'S'),
      dense(`Mute ${lane.name}`, 'mute', { 'aria-pressed': String(ls.mute) }, () => toggleLane(lane.id, 'mute'), 'M'),
      dense(`Duplicate ${lane.name}`, 'duplicate', { disabled: song.lanes.length >= S.MAX_LANES }, () => duplicateLane(lane.id), icon('library_add')),
      h('span', { class: 'pr-lane__spacer' }),
      dense(`Fewer beats in ${lane.name}`, 'beats-minus', { disabled: ls.beats <= S.MIN_BEATS }, () => setBeats(lane.id, ls.beats - 1), MINUS),
      h('span', { class: 'pr-lane__count', 'aria-label': `${ls.beats} beats`, text: String(ls.beats) }),
      dense(`More beats in ${lane.name}`, 'beats-plus', { disabled: ls.beats >= S.MAX_BEATS }, () => setBeats(lane.id, ls.beats + 1), '+')),
    h('div', { class: 'pr-lane__mix pr-desk-only' }, h('span', { text: 'Vol' }), vol, h('span', { text: 'Pan' }), pan));
}

function toggleLane(id, what) {
  history.seal();
  const on = !settings(id)[what];
  commit(S.setLaneSettings(song, scene, id, { [what]: on }));
  announce(`${laneAt(laneIdx(id)).name} ${on ? '' : 'un'}${what === 'solo' ? 'soloed' : 'muted'}`);
}

function duplicateLane(id) {
  history.seal();
  const next = S.duplicateLane(song, id);
  if (!next) return;
  commit(next);
  const copy = next.lanes[laneIdx(id) + 1];
  selectLane(copy.id);
  announce(`Duplicated ${copy.name}`);
}

function setBeats(id, n) {
  history.seal();
  const lane = laneAt(laneIdx(id));
  const before = settings(id).notes.length;
  if (commit(S.setBeats(song, scene, id, n), { key: `beats:${id}` })) {
    const lost = before - settings(id).notes.length;
    announce(`${lane.name}: ${n} beats${lost ? `, ${lost} note${lost > 1 ? 's' : ''} deleted` : ''}`);
  }
}

function startRename(id, nameBtn) {
  const lane = laneAt(laneIdx(id));
  const input = h('input', { class: 'pr-lane__rename', type: 'text', maxlength: String(32), value: lane.name, 'aria-label': 'Lane name' });
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value;
    input.replaceWith(nameBtn);
    if (save) commit(S.renameLane(song, id, value));
    else renderStage();
    focusLaneHeader(id);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  nameBtn.replaceWith(input);
  input.focus();
  input.select();
}

function focusLaneHeader(id) {
  $('lanes').querySelector(`.pt-lane:nth-child(${laneIdx(id) + 1}) .pr-lane__name`)?.focus();
}

function selectLane(id) {
  sel = { lane: id, beat: null };
  phoneTab = 'lane';
  cursor = { lane: laneIdx(id), beat: cursor.lane === laneIdx(id) ? cursor.beat : 0 };
  renderStage();
  renderPanel();
}

function selectNote(laneId, beat) {
  sel = { lane: laneId, beat };
  phoneTab = 'note';
  cursor = { lane: laneIdx(laneId), beat };
  renderStage();
  renderPanel();
}

function clearSelection() {
  if (sel.lane === null) return;
  sel = { lane: null, beat: null };
  renderStage();
  renderPanel();
}

function cellEl(li, beat) {
  const lane = laneAt(li);
  if (!lane) return null;
  const start = noteAtBeat(lane.id, beat)?.beat ?? beat;
  return $('lanes').querySelector(`[data-lane="${lane.id}"][data-beat="${start}"][role="gridcell"]`);
}

function focusCursor() {
  if (cursor.beat < 0) { focusLaneHeader(laneAt(cursor.lane)?.id); return; }
  cellEl(cursor.lane, cursor.beat)?.focus({ preventScroll: false });
}

// ---- Playheads: once per frame, read the audio clock ----

function drawHeads(force = false) {
  const t = ctx ? heardTime(ctx) : 0;
  const hs = hasPlayed ? seq.playheads(t) : null;
  for (const [id, { bar, cols }] of heads) {
    const p = hs?.find((x) => x.laneId === id);
    bar.hidden = !p;
    if (!p) { lastStep.delete(id); continue; }
    const step = Math.min(cols - 1, p.step);
    if (force || lastStep.get(id) !== step) {
      lastStep.set(id, step);
      bar.style.transform = `translateX(${step * 100}%)`;
    }
  }
}

// ---- Adding, moving and resizing notes ----

async function addNoteAt(laneId, beat) {
  const next = S.addNote(song, scene, laneId, beat);
  if (!next) { announce('That beat is taken'); return; }
  history.seal();
  // On a phone a tap only adds the note and plays it, so a beat can be tapped out quickly; nothing opens.
  if (isPhone()) cursor = { lane: laneIdx(laneId), beat };
  commit(next);
  if (!isPhone()) selectNote(laneId, beat);
  setHint('play');
  const n = settings(laneId).notes.find((x) => x.beat === beat);
  const lane = laneAt(laneIdx(laneId));
  announce(`${lane.name}, beat ${beat + 1}, ${R.fullName(n.cents)}, added`);
  await ensureAudio();
  sound.audition(lane.instrument, n, settings(laneId).envelope);
}

function deleteSelected() {
  if (sel.beat === null) return;
  const { lane, beat } = sel;
  history.seal();
  if (commit(S.removeNote(song, scene, lane, beat))) {
    sel = { lane, beat: null };
    cursor = { lane: laneIdx(lane), beat };
    renderStage();
    renderPanel();
    focusCursor();
    announce('Note deleted');
  }
}

function moveSelected(toLaneId, toBeat, { copy = false } = {}) {
  const next = S.moveNote(song, scene, sel.lane, sel.beat, toLaneId, toBeat, { copy });
  if (!next) { announce('Blocked: those beats are taken'); renderStage(); return false; }
  history.seal();
  commit(next);
  selectNote(toLaneId, toBeat);
  return true;
}

/** Copy the selected note onto the next free beat and select the copy. ⌘D, and the phone's Duplicate button. */
function duplicateSelectedNote() {
  if (sel.beat === null) return false;
  const b = S.nextFreeBeat(song, scene, sel.lane, sel.beat);
  if (b < 0) { announce('No free beat for a copy'); return false; }
  if (!moveSelected(sel.lane, b, { copy: true })) return false;
  cursor = { lane: laneIdx(sel.lane), beat: b };
  announce('Note duplicated');
  return true;
}

function beatAtPointer(track, clientX) {
  const r = track.getBoundingClientRect();
  const cols = Number(track.dataset.cols);
  return Math.floor(((clientX - r.left) / r.width) * cols);
}

function trackAt(clientY) {
  for (const track of $('lanes').querySelectorAll('.pt-track')) {
    const r = track.parentElement.getBoundingClientRect();
    if (clientY >= r.top - 6 && clientY <= r.bottom + 6) return track;
  }
  return null;
}

let drag = null;
$('lanes').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || eraseMode) return;
  const noteEl = e.target.closest('.pr-note');
  if (!noteEl) return;
  const laneId = noteEl.dataset.lane;
  const beat = Number(noteEl.dataset.beat);
  const note = settings(laneId).notes.find((n) => n.beat === beat);
  const track = noteEl.closest('.pt-track');
  const grabbed = beatAtPointer(track, e.clientX);
  drag = {
    mode: e.target.closest('.pr-note__grab') ? 'resize' : 'move',
    laneId, beat, note, startX: e.clientX, startY: e.clientY, moved: false,
    offset: Math.max(0, Math.min(note.length - 1, grabbed - beat)), target: null, alt: e.altKey,
  };
  history.seal();
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp, { once: true });
  addEventListener('pointercancel', onPointerUp, { once: true });
});

function clearTargets() {
  $('lanes').querySelectorAll('.is-target').forEach((el) => el.classList.remove('is-target'));
}

function onPointerMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return; // a click never moves a note
  if (!drag.moved) {
    drag.moved = true;
    if (!(sel.lane === drag.laneId && sel.beat === drag.beat)) { sel = { lane: drag.laneId, beat: drag.beat }; }
    if (drag.mode === 'move' && !e.altKey) $('lanes').querySelector(`.pr-note[data-lane="${drag.laneId}"][data-beat="${drag.beat}"]`)?.classList.add('is-dragging');
  }
  if (drag.mode === 'resize') {
    const track = $('lanes').querySelector(`.pt-track[data-lane="${drag.laneId}"]`);
    const length = beatAtPointer(track, e.clientX) - drag.beat + 1;
    const cur = settings(drag.laneId).notes.find((n) => n.beat === drag.beat);
    if (cur && length !== cur.length) {
      const next = S.resizeNote(song, scene, drag.laneId, drag.beat, length);
      if (next && next !== song) {
        commit(next, { key: `resize:${drag.laneId}:${drag.beat}` });
        sel = { lane: drag.laneId, beat: drag.beat };
      }
    }
    return;
  }
  clearTargets();
  const track = trackAt(e.clientY);
  drag.target = null;
  if (!track) return;
  const lane = track.dataset.lane;
  const beat = beatAtPointer(track, e.clientX) - drag.offset;
  const ls = settings(lane);
  if (beat < 0 || beat >= ls.beats) return;
  drag.target = { lane, beat };
  const el = track.querySelector(`[data-beat="${beat}"][role="gridcell"]`) ?? cellEl(laneIdx(lane), beat);
  el?.classList.add('is-target');
}

function onPointerUp(e) {
  removeEventListener('pointermove', onPointerMove);
  removeEventListener('pointerup', onPointerUp);
  removeEventListener('pointercancel', onPointerUp);
  const d = drag;
  drag = null;
  if (!d) return;
  clearTargets();
  history.seal();
  if (!d.moved) {
    // A click: select the note, or clear the selection if it is already selected.
    if (sel.lane === d.laneId && sel.beat === d.beat) { sel = { lane: null, beat: null }; renderStage(); renderPanel(); }
    else selectNote(d.laneId, d.beat);
    return;
  }
  if (d.mode === 'resize') { renderStage(); return; }
  if (d.target && !(d.target.lane === d.laneId && d.target.beat === d.beat)) {
    sel = { lane: d.laneId, beat: d.beat };
    moveSelected(d.target.lane, d.target.beat, { copy: e.altKey || d.alt });
  } else {
    renderStage();
  }
}

$('lanes').addEventListener('dblclick', (e) => {
  const noteEl = e.target.closest('.pr-note');
  if (!noteEl || isPhone()) return; // a phone has no double-click: two quick taps would add a note and remove it
  e.preventDefault();
  sel = { lane: noteEl.dataset.lane, beat: Number(noteEl.dataset.beat) };
  deleteSelected();
});

$('lanes').addEventListener('click', (e) => {
  if (eraseMode) {
    const noteEl = e.target.closest('.pr-note');
    if (noteEl) { sel = { lane: noteEl.dataset.lane, beat: Number(noteEl.dataset.beat) }; deleteSelected(); clearSelection(); }
    return;
  }
  const cell = e.target.closest('.pt-cell:not(.pt-cell--ghost)');
  if (cell) addNoteAt(cell.dataset.lane, Number(cell.dataset.beat));
});

// ---- Keyboard on the stage ----

function moveCursorTo(li, beat) {
  cursor = { lane: li, beat };
  $('lanes').querySelectorAll('[role="gridcell"][tabindex="0"]').forEach((el) => { el.tabIndex = -1; });
  if (beat < 0) { focusLaneHeader(laneAt(li).id); return; }
  const target = cellEl(li, beat);
  if (target) { target.tabIndex = 0; target.focus(); }
}

$('lanes').addEventListener('focusin', (e) => {
  const cell = e.target.closest?.('[role="gridcell"]');
  if (cell) cursor = { lane: laneIdx(cell.dataset.lane), beat: Number(cell.dataset.beat) };
});

function onStageKey(e) {
  const lane = laneAt(cursor.lane);
  if (!lane) return;
  const ls = settings(lane.id);
  const onCell = e.target.matches('[role="gridcell"]');
  const onHeader = e.target.matches('.pr-lane__name');
  const mod = e.metaKey || e.ctrlKey;
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];

  if (arrow && e.altKey && !mod && sel.beat !== null) { // move the selected note
    e.preventDefault();
    const li = laneIdx(sel.lane);
    const toLane = laneAt(li + arrow[1]);
    if (!toLane) return;
    const toBeat = sel.beat + arrow[0];
    if (toBeat < 0 || toBeat >= settings(toLane.id).beats) return;
    if (moveSelected(toLane.id, toBeat)) { cursor = { lane: laneIdx(toLane.id), beat: toBeat }; focusCursor(); }
    return;
  }
  if (arrow && e.shiftKey && arrow[0] && sel.beat !== null && onCell) { // change the selected note's length
    e.preventDefault();
    const cur = settings(sel.lane).notes.find((n) => n.beat === sel.beat);
    history.seal();
    if (commit(S.resizeNote(song, scene, sel.lane, sel.beat, cur.length + arrow[0]))) { focusCursor(); announce(`${cur.length + arrow[0]} beats`); }
    return;
  }
  if (arrow && !mod && !e.altKey && !e.shiftKey) {
    if (!(onCell || onHeader)) return;
    e.preventDefault();
    if (arrow[0]) {
      const here = cursor.beat < 0 ? -1 : (noteAtBeat(lane.id, cursor.beat)?.beat ?? cursor.beat);
      if (arrow[0] > 0) {
        const len = here < 0 ? 0 : (noteAtBeat(lane.id, here)?.length ?? 1);
        const nb = here < 0 ? 0 : here + len;
        if (nb < ls.beats) moveCursorTo(cursor.lane, nb);
      } else if (here >= 0) {
        moveCursorTo(cursor.lane, here === 0 ? -1 : (noteAtBeat(lane.id, here - 1)?.beat ?? here - 1));
      }
    } else {
      const li = cursor.lane + arrow[1];
      if (li >= 0 && li < song.lanes.length) {
        const b = cursor.beat < 0 ? -1 : Math.min(cursor.beat, settings(laneAt(li).id).beats - 1);
        moveCursorTo(li, b);
      }
    }
    return;
  }
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'c' && sel.beat !== null && onCell) {
      e.preventDefault();
      const n = settings(sel.lane).notes.find((x) => x.beat === sel.beat);
      noteClipboard = { ...n };
      announce('Note copied');
    } else if (k === 'v' && noteClipboard && onCell) {
      e.preventDefault();
      const length = Math.min(noteClipboard.length, ls.beats - cursor.beat);
      const next = cursor.beat >= 0 ? S.addNote(song, scene, lane.id, cursor.beat, { ...noteClipboard, beat: cursor.beat, length }) : null;
      if (!next) { announce('Blocked: those beats are taken'); return; }
      history.seal();
      commit(next);
      selectNote(lane.id, cursor.beat);
      focusCursor();
      announce('Note pasted');
    } else if (k === 'd' && sel.beat !== null && onCell) {
      e.preventDefault(); // overrides the browser's bookmark shortcut only while the stage has focus
      if (duplicateSelectedNote()) focusCursor();
    }
    return;
  }
  if (mod || e.altKey) return;

  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      if (onHeader) {
        if (sel.lane === lane.id) startRename(lane.id, e.target);
        else selectLane(lane.id), focusLaneHeader(lane.id);
      } else if (onCell) {
        const note = noteAtBeat(lane.id, cursor.beat);
        if (note) { selectNote(lane.id, note.beat); focusCursor(); }
        else addNoteAt(lane.id, cursor.beat).then(focusCursor);
      }
      break;
    case 'F2':
      e.preventDefault();
      startRename(lane.id, $('lanes').querySelector(`.pt-lane:nth-child(${cursor.lane + 1}) .pr-lane__name`));
      break;
    case 'Delete':
    case 'Backspace':
      // Like Ableton: Delete removes whatever has focus. A note on the stage deletes the note; the lane header deletes the lane.
      if (onCell && e.target.matches('.pr-note')) {
        e.preventDefault();
        sel = { lane: e.target.dataset.lane, beat: Number(e.target.dataset.beat) };
        deleteSelected();
      } else if (onHeader) {
        e.preventDefault();
        sel = { lane: lane.id, beat: null };
        deleteSelectedLane();
      }
      break;
    case 'Escape':
      if (sel.lane !== null) { e.preventDefault(); clearSelection(); focusCursor(); }
      break;
    case '-': if (onCell) { e.preventDefault(); setZoom(zoom - 8); } break;
    case '=': case '+': if (onCell) { e.preventDefault(); setZoom(zoom + 8); } break;
    case '0': if (onCell) { e.preventDefault(); setZoom(ZOOM_MIN); } break;
    case 'e': case 'E': e.preventDefault(); focusPanel(); break;
    default:
  }
}
$('lanes').addEventListener('keydown', onStageKey);

// ---------- Settings panel ----------

const panelCollapsed = () => !isPhone() && pref(store.KEYS.panelCollapsed, false);
function setPanelCollapsed(c) {
  setPref(store.KEYS.panelCollapsed, c);
  renderPanel();
}
$('panel-collapse').addEventListener('click', () => { setPanelCollapsed(true); $('panel-expand').focus(); });
for (const id of ['panel-expand', 'panel-bar-label']) $(id).addEventListener('click', () => { setPanelCollapsed(false); $('panel-collapse').focus(); });

function focusPanel() {
  if (sel.lane === null) return;
  if (panelCollapsed()) setPanelCollapsed(false);
  (sel.beat !== null ? $('n-pitch') : $('tuning')).focus();
}

const TUNING_OPTIONS = TUNINGS.map((t) => h('option', { value: t.id, text: t.label }));
$('tuning').append(...TUNING_OPTIONS);

function envelopePoints(env) {
  const a = env.attackMs, d = env.decayMs, r = env.releaseMs;
  const hold = Math.max(40, (a + d + r) * 0.3);
  const total = a + d + hold + r || 1;
  const x = (ms) => ((ms / total) * 200).toFixed(1);
  const y = (pct) => (44 - 4 - (pct / 100) * 36).toFixed(1);
  return `0,${y(0)} ${x(a)},${y(100)} ${x(a + d)},${y(env.sustainPct)} ${x(a + d + hold)},${y(env.sustainPct)} ${x(total)},${y(0)}`;
}

function setIfIdle(el, value) {
  if (document.activeElement !== el) el.value = value;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const logPos = (v, lo, hi) => clamp01(Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo));
const setBar = (id, p) => $(id).closest('.pt-param')?.style.setProperty('--p', String(clamp01(p)));
const padTo = (text, n) => String(text).padStart(n, ' ');

function renderPanel() {
  const panel = $('panel');
  const bar = $('panel-bar');
  const none = sel.lane === null;
  const collapsed = panelCollapsed();
  panel.hidden = none || collapsed;
  bar.hidden = none || !collapsed;
  document.body.classList.toggle('pt-has-selection', !none);
  renderHint();
  if (none) return;
  const lane = laneAt(laneIdx(sel.lane));
  const ls = settings(lane.id);
  $('lane-title').textContent = lane.name;
  $('tuning').value = ls.tuning;
  for (const k of ['attackMs', 'decayMs', 'sustainPct', 'releaseMs']) setIfIdle($(`env-${k}`), String(ls.envelope[k]));
  $('env-line').setAttribute('points', envelopePoints(ls.envelope));
  for (const k of ['attackMs', 'decayMs', 'releaseMs']) setBar(`env-${k}`, logPos(ls.envelope[k] + 1, 1, 5001));
  setBar('env-sustainPct', ls.envelope.sustainPct / 100);
  renderPhoneLane(lane, ls);

  const note = sel.beat === null ? null : ls.notes.find((n) => n.beat === sel.beat);
  // Phones: Note and Lane tabs. The Note tab is there only while a note is selected.
  const tab = note && phoneTab === 'note' ? 'note' : 'lane';
  panel.dataset.tab = tab;
  $('tab-note').setAttribute('aria-selected', String(tab === 'note'));
  $('tab-note').tabIndex = tab === 'note' ? 0 : -1;
  $('tab-note').disabled = !note;
  $('tab-lane').setAttribute('aria-selected', String(tab === 'lane'));
  $('tab-lane').tabIndex = tab === 'lane' ? 0 : -1;
  $('note-fields').style.visibility = note ? 'visible' : 'hidden';
  $('note-chip').hidden = !note;
  const title = $('note-title');
  title.classList.toggle('is-empty', !note);
  $('delete-note').hidden = !note;
  if (!note) {
    title.textContent = 'No note selected';
    $('note-readout').textContent = '';
    return;
  }
  const hz = S.centsToHz(note.cents);
  const c = noteColor(hz, { saturation: 100 - note.noisePct, db: note.volumeDb });
  $('note-chip').style.setProperty('--swatch', c.hex);
  title.textContent = `${lane.name} · beat ${note.beat + 1} · ${R.shortName(note.cents)}`;
  $('note-readout').textContent = `${padTo(c.nm.toFixed(0), 3)} nm · H ${padTo(Math.round(c.h), 3)}° S ${padTo(Math.round(c.s), 3)}% L ${padTo(Math.round(c.l), 3)}%`;
  const split = R.splitPitch(note.cents);
  setIfIdle($('n-pitch'), split.label);
  $('n-pitch-step').textContent = R.stepText(note.cents, ls.tuning);
  setIfIdle($('n-octave'), String(split.octave));
  setIfIdle($('n-noise'), String(Math.round(note.noisePct)));
  setIfIdle($('n-hz'), String(+hz.toFixed(2)));
  setIfIdle($('n-length'), String(note.length));
  $('n-length').max = String(ls.beats - note.beat);
  setIfIdle($('n-volume'), String(Math.round(note.volumeDb * 10) / 10));
  setBar('n-octave', (split.octave + 2) / 12);
  setBar('n-hz', logPos(hz, 20, 20000));
  setBar('n-length', note.length / ls.beats);
  setBar('n-noise', note.noisePct / 100);
  setBar('n-volume', dbToPos(note.volumeDb) / 100);
}

/** The Lane tab's phone-only controls: Solo, Mute, Duplicate, beats, and the Volume and Pan cells. */
function renderPhoneLane(lane, ls) {
  const pressed = (id, on, label) => { $(id).setAttribute('aria-pressed', String(on)); $(id).setAttribute('aria-label', label); };
  pressed('p-solo', ls.solo, `Solo ${lane.name}`);
  pressed('p-mute', ls.mute, `Mute ${lane.name}`);
  $('p-dup-lane').disabled = song.lanes.length >= S.MAX_LANES;
  $('p-dup-lane').setAttribute('aria-label', `Duplicate ${lane.name} below`);
  $('p-beats').textContent = String(ls.beats);
  $('p-beats-minus').disabled = ls.beats <= S.MIN_BEATS;
  $('p-beats-minus').setAttribute('aria-label', `Fewer beats in ${lane.name}, now ${ls.beats}`);
  $('p-beats-plus').disabled = ls.beats >= S.MAX_BEATS;
  $('p-beats-plus').setAttribute('aria-label', `More beats in ${lane.name}, now ${ls.beats}`);
  setIfIdle($('p-lane-vol'), String(Math.round(ls.volumeDb * 10) / 10));
  setBar('p-lane-vol', dbToPos(ls.volumeDb) / 100);
  const pan = Math.round(ls.pan * 100);
  setIfIdle($('p-lane-pan'), String(pan));
  $('p-lane-pan-unit').textContent = pan < 0 ? 'L' : pan > 0 ? 'R' : 'C';
  setBar('p-lane-pan', (ls.pan + 1) / 2);
}

function editNote(patch, key) {
  if (sel.beat === null) return;
  commit(S.setNote(song, scene, sel.lane, sel.beat, patch), { key: key ? `${key}:${sel.lane}:${sel.beat}` : null });
}

$('tuning').addEventListener('change', async (e) => {
  const id = sel.lane;
  const tuning = e.target.value;
  const moved = S.tuningMoveCount(song, id, tuning);
  if (moved) {
    const label = getTuning(tuning).label;
    const yes = await confirmOnce('tuning', { title: `Change tuning to ${label}?`, text: `Move ${moved} note${moved > 1 ? 's' : ''} to the nearest ${label} step?`, ok: 'Change tuning' });
    if (!yes) { e.target.value = settings(id).tuning; return; }
  }
  history.seal();
  commit(S.setTuning(song, id, tuning));
});

for (const k of ['attackMs', 'decayMs', 'sustainPct', 'releaseMs']) {
  const el = $(`env-${k}`);
  el.addEventListener('input', () => {
    if (sel.lane === null || el.value === '') return;
    commit(S.setLaneSettings(song, scene, sel.lane, { envelope: { [k]: Number(el.value) } }), { key: `env:${sel.lane}`, stage: false });
  });
  el.addEventListener('change', () => { seal(); if (!scrubbing) renderPanel(); });
  el.addEventListener('keydown', (e) => { // up and down: 10 ms (or 10 %), Shift for 1
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const v = Number(el.value || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : k === 'sustainPct' ? 5 : 10);
    el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), v)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.select();
  });
}

$('n-noise').addEventListener('input', (e) => { if (e.target.value !== '') editNote({ noisePct: Math.max(0, Math.min(100, Number(e.target.value))) }, 'noise'); });
$('n-volume').addEventListener('input', (e) => { if (e.target.value !== '' && e.target.value !== '-') editNote({ volumeDb: Math.max(S.DB_MIN, Math.min(0, Number(e.target.value))) }, 'volume'); });
for (const id of ['n-noise', 'n-volume']) $(id).addEventListener('change', () => { seal(); if (!scrubbing) renderPanel(); });

function currentNote() {
  return sel.beat === null ? null : settings(sel.lane).notes.find((n) => n.beat === sel.beat);
}

let scrubbing = false; // while dragging a cell, the whole drag is one undo step
const seal = () => { if (!scrubbing) history.seal(); };

function commitPitch(cents) {
  seal();
  editNote({ cents });
  seal();
}

function stepPitchBy(dir) {
  const n = currentNote();
  if (!n) return;
  commitPitch(R.stepPitch(n.cents, settings(sel.lane).tuning, dir));
  const now = currentNote();
  $('n-pitch').value = R.splitPitch(now.cents).label;
  renderPanel();
}

$('n-pitch').addEventListener('change', (e) => {
  const n = currentNote();
  if (!n) return;
  const p = R.parsePitchText(e.target.value);
  if (!p) { renderPanel(); e.target.value = R.splitPitch(n.cents).label; return; }
  const { tuning } = settings(sel.lane);
  const cents = S.snapCents(R.centsFromName(p.name, R.splitPitch(n.cents).octave, p.offset), tuning);
  commitPitch(cents);
  e.target.value = R.splitPitch(currentNote().cents).label;
});
// Up and down step a pitch by one step of the lane's tuning, from the Pitch or Hz cell.
for (const id of ['n-pitch', 'n-hz']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    stepPitchBy(e.key === 'ArrowUp' ? 1 : -1);
    if (id === 'n-hz') $('n-hz').select();
  });
}
$('n-octave').addEventListener('change', (e) => {
  const n = currentNote();
  if (!n || e.target.value === '') return;
  commitPitch(n.cents + (Math.round(Number(e.target.value)) - R.splitPitch(n.cents).octave) * 1200);
});
$('n-hz').addEventListener('change', (e) => {
  const n = currentNote();
  const hz = Number(e.target.value);
  if (!n || !(hz > 0)) { renderPanel(); return; }
  commitPitch(R.hzToCents(hz, settings(sel.lane).tuning));
});
$('n-length').addEventListener('change', (e) => {
  const n = currentNote();
  if (!n) return;
  seal();
  commit(S.resizeNote(song, scene, sel.lane, sel.beat, Math.round(Number(e.target.value))));
  renderPanel();
});

async function deleteSelectedLane() {
  if (sel.lane === null) return;
  const lane = laneAt(laneIdx(sel.lane));
  const yes = await confirmOnce('delete-lane', { title: `Delete ${lane.name}?`, text: `This removes the lane and its notes from all ${S.SCENE_COUNT} scenes.`, ok: 'Delete lane' });
  if (!yes) return;
  history.seal();
  const li = laneIdx(lane.id);
  commit(S.removeLane(song, lane.id));
  cursor = { lane: Math.min(li, song.lanes.length - 1), beat: 0 };
  renderStage();
  announce(`Deleted ${lane.name}`);
}
$('delete-lane').addEventListener('click', deleteSelectedLane);
$('delete-note').addEventListener('click', deleteSelected);

// ---- Phone-only settings controls (the Lane and Note tabs of the settings drawer) ----

$('tab-note').addEventListener('click', () => { phoneTab = 'note'; renderPanel(); $('tab-note').focus(); });
$('tab-lane').addEventListener('click', () => { phoneTab = 'lane'; renderPanel(); $('tab-lane').focus(); });
for (const id of ['tab-note', 'tab-lane']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const other = id === 'tab-note' ? 'tab-lane' : 'tab-note';
    if (!$(other).disabled) $(other).click();
  });
}
$('panel-close').addEventListener('click', () => { clearSelection(); focusCursor(); });
$('p-solo').addEventListener('click', () => toggleLane(sel.lane, 'solo'));
$('p-mute').addEventListener('click', () => toggleLane(sel.lane, 'mute'));
$('p-dup-lane').addEventListener('click', () => duplicateLane(sel.lane));
$('p-beats-minus').addEventListener('click', () => setBeats(sel.lane, settings(sel.lane).beats - 1));
$('p-beats-plus').addEventListener('click', () => setBeats(sel.lane, settings(sel.lane).beats + 1));
$('p-lane-vol').addEventListener('input', (e) => {
  if (sel.lane === null || e.target.value === '' || e.target.value === '-') return;
  commit(S.setLaneSettings(song, scene, sel.lane, { volumeDb: Math.max(S.DB_MIN, Math.min(0, Number(e.target.value))) }), { key: `vol:${sel.lane}`, stage: false });
});
// Pan runs −100 (left) to 100 (right); the unit says which side: L, C or R.
$('p-lane-pan').addEventListener('input', (e) => {
  if (sel.lane === null || e.target.value === '' || e.target.value === '-') return;
  commit(S.setLaneSettings(song, scene, sel.lane, { pan: Math.max(-1, Math.min(1, Number(e.target.value) / 100)) }), { key: `pan:${sel.lane}`, stage: false });
});
for (const id of ['p-lane-vol', 'p-lane-pan']) $(id).addEventListener('change', () => { seal(); if (!scrubbing) renderPanel(); });
$('rename-lane').addEventListener('click', async () => {
  const lane = laneAt(laneIdx(sel.lane));
  if (!lane) return;
  const name = await ask({ title: 'Rename lane', input: lane.name, ok: 'Rename' });
  if (name !== null) { history.seal(); commit(S.renameLane(song, lane.id, name)); }
});
$('p-delete-lane').addEventListener('click', deleteSelectedLane);
$('p-delete-note').addEventListener('click', () => { deleteSelected(); clearSelection(); });
$('p-dup-note').addEventListener('click', duplicateSelectedNote);

// ---- Scrubbing: drag a cell up or down to change its value (the pointer is a shortcut, never the only way) ----

const SCRUB_PX = 4; // pixels of travel per step
const SCRUB = {
  'env-attackMs': { step: 10, fine: 1 }, 'env-decayMs': { step: 10, fine: 1 }, 'env-releaseMs': { step: 10, fine: 1 },
  'env-sustainPct': { step: 1, fine: 1 }, 'n-octave': { step: 1, fine: 1 }, 'n-length': { step: 1, fine: 1 },
  'n-noise': { step: 1, fine: 1 }, 'n-volume': { step: 1, fine: 0.1 },
  'n-pitch': { pitch: true }, 'n-hz': { pitch: true },
  'p-lane-vol': { step: 1, fine: 0.1 }, 'p-lane-pan': { step: 5, fine: 1 },
};
let scrub = null;
$('panel').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (isPhone()) return; // a phone steps values with the nudge bar: a drag there is too twitchy and fights the scroll
  const cell = e.target.closest('.pt-param');
  const input = cell?.querySelector('.pt-param__input');
  if (!input || !SCRUB[input.id] || input.tagName === 'SELECT') return;
  scrub = { cell, input, spec: SCRUB[input.id], y: e.clientY, steps: 0, moved: false, base: Number(input.value), pointer: e.pointerId };
});
addEventListener('pointermove', (e) => {
  if (!scrub || e.pointerId !== scrub.pointer) return;
  if (!scrub.moved) {
    if (Math.abs(e.clientY - scrub.y) < 4) return;
    scrub.moved = true;
    scrubbing = true;
    history.seal();
    scrub.cell.classList.add('is-scrubbing');
    document.activeElement?.blur?.();
    document.body.style.userSelect = 'none';
  }
  const px = SCRUB_PX * (e.shiftKey ? 3 : 1);
  const steps = Math.round((scrub.y - e.clientY) / px);
  if (steps === scrub.steps) return;
  const delta = steps - scrub.steps;
  scrub.steps = steps;
  const { spec, input } = scrub;
  if (spec.pitch) { for (let i = 0; i < Math.abs(delta); i++) stepPitchBy(Math.sign(delta)); return; }
  const unit = e.shiftKey ? spec.fine : spec.step;
  const lo = input.min === '' ? -Infinity : Number(input.min);
  const hi = input.max === '' ? Infinity : Number(input.max);
  const v = Math.max(lo, Math.min(hi, Math.round((Number(input.value) + delta * unit) * 10) / 10));
  input.value = String(v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
function endScrub(e) {
  if (!scrub || (e && e.pointerId !== scrub.pointer)) return;
  const was = scrub.moved;
  scrub.cell.classList.remove('is-scrubbing');
  scrub = null;
  document.body.style.userSelect = '';
  if (was) { scrubbing = false; history.seal(); renderPanel(); }
}
addEventListener('pointerup', endScrub);
addEventListener('pointercancel', endScrub);
// A drag that moved must not also focus the box for typing.
$('panel').addEventListener('click', (e) => {
  const cell = e.target.closest('.pt-param');
  if (!cell || e.target.matches('input, select')) return;
  cell.querySelector('.pt-param__input')?.focus();
});

// ---- Phones: value cells take focus without the keyboard, and a nudge bar changes them ----
// One bar sits at the foot of the settings panel; a second drops under the top bar while BPM has focus.
// A press (or a whole hold) is one undo step, the same as a scrub.
const nudgeSession = {
  begin() { history.seal(); scrubbing = true; },
  end() { scrubbing = false; history.seal(); renderPanel(); },
};
const nudgePitch = {
  step: (dir) => stepPitchBy(dir),
  octave: (dir) => { const n = currentNote(); if (n) { commitPitch(n.cents + dir * 1200); renderPanel(); } },
};
const panelNudge = createNudge({ session: nudgeSession, pitch: nudgePitch, label: 'Change the selected value' });
$('panel').append(panelNudge.el);
panelNudge.el.classList.add('pr-phone-only');
panelNudge.watch($('panel'));
const bpmNudge = createNudge({ session: nudgeSession, pitch: nudgePitch, float: true, label: 'Change the tempo' });
bpmNudge.el.classList.add('pr-phone-only');
document.querySelector('.pr-app').append(bpmNudge.el);
bpmNudge.watch($('bpm'));

/** On a phone the cells and BPM never raise the keyboard on their own; the bar's keyboard button does. */
function applyPhoneInputs() {
  for (const el of document.querySelectorAll('#panel input.pt-param__input, #bpm')) {
    if (isPhone()) el.inputMode = 'none';
    else if (el.id === 'bpm') el.inputMode = 'decimal';
    else el.removeAttribute('inputmode');
  }
  if (!isPhone()) { panelNudge.setTarget(null); bpmNudge.setTarget(null); }
}
applyPhoneInputs();
onPhoneChange(applyPhoneInputs);

// Esc in a settings field goes back to the same cell on the stage.
$('panel').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || dialog.open) return;
  e.preventDefault();
  if (sel.beat !== null) cursor = { lane: laneIdx(sel.lane), beat: sel.beat };
  else if (sel.lane !== null) cursor = { lane: laneIdx(sel.lane), beat: -1 };
  focusCursor();
});

// ---------- Keyboard shortcuts dialog ----------

const shortcuts = bindShortcuts({ trigger: $('shortcuts-link'), groups: SHORTCUTS });
const shortcutsDialog = shortcuts.dialog;

// ---------- Global keys ----------

document.addEventListener('keydown', (e) => {
  const t = e.target;
  const inField = t.closest?.('input[type="text"], input[type="number"], textarea, select, [contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (mod && !e.altKey && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); return; }
  if (mod || e.altKey || inField || dialog.open || shortcutsDialog.open) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel.lane !== null && sel.beat === null && !t.closest?.('[role="gridcell"], [role="tablist"]')) { e.preventDefault(); deleteSelectedLane(); return; }
  if (/^[1-5]$/.test(e.key)) { setScene(Number(e.key) - 1); return; }
  if ((e.key === 's' || e.key === 'S') && sel.lane !== null) {
    toggleLane(sel.lane, 'solo');
  } else if ((e.key === 'm' || e.key === 'M') && sel.lane !== null) {
    toggleLane(sel.lane, 'mute');
  }
});

// ---------- Erase (phones) ----------

/** Erase removes the selected note or lane; with nothing selected it toggles erase mode (spec, Phones). */
function eraseTap() {
  if (sel.beat !== null) { deleteSelected(); clearSelection(); return; }
  if (sel.lane !== null) { deleteSelectedLane(); return; }
  eraseMode = !eraseMode;
  renderStage();
  renderTop();
  announce(eraseMode ? 'Erase mode on: tap notes or lane names to remove them' : 'Erase mode off');
}
const eraseLabel = () => (sel.beat !== null ? 'Erase the selected note' : sel.lane !== null ? 'Erase the selected lane' : 'Erase mode: tap notes or lane names to remove them');

// ---------- Poly's note (first visit) ----------
// "Tap a square to add a beat", then "Now press play" after the first note; gone once the song plays.

const HINTS = {
  tap: ['Tap a square to add a beat', 'It sounds right away and lights up in its note’s color.'],
  play: ['Now press play', 'Each lane loops on its own length. Keep tapping while it plays.'],
};
const HINT_ORDER = ['tap', 'play', 'done'];
let hint = firstVisit ? 'tap' : pref(store.KEYS.hint, 'done');
if (firstVisit) setPref(store.KEYS.hint, hint);
function setHint(next) {
  if (HINT_ORDER.indexOf(next) <= HINT_ORDER.indexOf(hint)) return;
  hint = next;
  setPref(store.KEYS.hint, hint);
  renderHint();
}
function renderHint() {
  const el = $('poly-hint');
  const show = hint !== 'done' && song.lanes.length > 0 && sel.lane === null && !phone?.frame.openId;
  el.hidden = !show;
  if (!show) return;
  $('poly-hint-title').textContent = HINTS[hint][0];
  $('poly-hint-text').textContent = HINTS[hint][1];
}
$('poly-hint').querySelector('.pt-hint__poly').append(document.querySelector('.pr-logo .poly').cloneNode(true));
addEventListener('drawerchange', renderHint);

// ---------- Start ----------

phone = setupPhone({
  instruments: S.INSTRUMENTS.map((i) => ({ id: i.id, name: i.name, group: i.group, color: noteColor(S.centsToHz(i.cents), { saturation: 100 - i.noisePct }).hex })),
  maxLanes: S.MAX_LANES,
  laneCount: () => song.lanes.length,
  songName: () => song.name,
  sceneNumber: () => scene + 1,
  addLane,
  preview: async (id) => { await ensureAudio(); sound.preview(id); },
  erase: eraseTap, eraseOn: () => eraseMode, eraseLabel,
  undo, redo, canUndo: () => history.canUndo, canRedo: () => history.canRedo,
  async renameSong() {
    const name = await ask({ title: 'Rename song', input: song.name, ok: 'Rename' });
    const renamed = name === null ? null : S.setName(song, name);
    if (renamed && renamed.name !== song.name) { history.seal(); commit(renamed); }
  },
  newSong: () => $('new').click(),
  openEntries,
  save: doSave,
  exportSong: () => $('export-song').click(),
  exportWav: () => $('export-wav').click(),
  duplicateScene: () => duplicateScene(scene),
  clearScene: () => clearSceneAt(scene),
  canDuplicateScene: () => !S.sceneIsEmpty(sc()) && S.nextEmptyScene(song, scene) >= 0,
  zoom: { min: ZOOM_MIN, max: ZOOM_MAX, get: () => zoom, set: setZoom },
  fullscreen: {
    supported: canFullscreen,
    active: isFullscreen,
    // Called straight from a tap: entering full screen needs the tap's user gesture.
    toggle() {
      if (isFullscreen()) { setPref(store.KEYS.fullscreen, 'off'); exitFullscreen(); } else { setPref(store.KEYS.fullscreen, 'on'); enterFullscreen(); }
    },
  },
  master: {
    get: () => dbToPos(song.masterDb),
    set: (p) => commit(S.setMasterDb(song, posToDb(p)), { key: 'master', stage: false }),
    done: () => history.seal(),
    text: () => dbText(song.masterDb),
  },
});
onPhoneChange(() => { eraseMode = false; renderTop(); renderStage(); renderPanel(); });

// Phones, landscape: the first tap hides the browser's bars (Android; iPhone Safari can't). Once per visit,
// and never again if Full screen was turned off in the Menu. Leaving it with the system gesture is respected.
function autoFullscreen() {
  if (!isPhone() || !canFullscreen() || isFullscreen() || pref(store.KEYS.fullscreen, 'on') === 'off') return;
  if (!matchMedia('(orientation: landscape)').matches) return;
  removeEventListener('pointerup', autoFullscreen, true);
  enterFullscreen();
}
addEventListener('pointerup', autoFullscreen, true);
onFullscreenChange(() => phone?.render());

renderInstruments();
setSidebar(pref(store.KEYS.instrumentsCollapsed, matchMedia('(max-width: 820px)').matches), false);
setZoom(zoom);
seq.restart(0, { song, sceneIndex: 0 });
renderTop();
renderStage();
renderPanel();
