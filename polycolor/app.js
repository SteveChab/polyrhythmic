// polycolor app: DOM and wiring. Logic lives in model.js, sound in sound.js, the color model and
// tuning list in ../shared/. The state is a short list of dots (colors) plus the wheel's masters.

import * as M from './model.js';
import { createSound } from './sound.js';
import { TUNINGS, getTuning } from '../shared/tuning.js';
import { rgbToHsl, hslToRgb } from '../shared/color.js';
import { unlockAudio } from '../shared/clock.js';
import { lightnessToDb } from '../shared/color.js';
import { bindSpace, h, icon } from '../shared/ui.js';
import { createHistory } from '../shared/history.js';
import { createConfirmOnce } from '../shared/confirm-once.js';
import { bindShortcuts } from '../shared/shortcuts.js';
import { isPhone, onPhoneChange, createPhoneFrame, menuItem, menuFooter, fullscreenControls } from '../shared/phone.js';

const $ = (id) => document.getElementById(id);
const STORE = 'polycolor:state';
const MINUS = '−';


// ---------- State ----------

let st = (() => {
  try {
    const saved = localStorage.getItem(STORE);
    return saved === null ? M.brandState() : M.restoreState(JSON.parse(saved));
  } catch { return M.brandState(); }
})();

let openId = null; // phones: the swatch whose details replace the list (null: the list shows)

// ---------- Undo and redo ----------
// A step is a snapshot of the palette, masters, tuning and snap. Selection and volume are not edits.

const history = createHistory(st);
const editKey = (s) => JSON.stringify([s.dots, s.masterSat, s.masterLight, s.tuning, s.snap, s.nextId]);
let lastEdit = editKey(st);
function record(key = null) {
  const k = editKey(st);
  if (k === lastEdit) return;
  lastEdit = k;
  history.push(st, 0, key);
  renderHistoryButtons();
}
function renderHistoryButtons() {
  queueMicrotask(() => {
    document.getElementById('rail-undo')?.toggleAttribute('disabled', $('undo').disabled);
    document.getElementById('rail-redo')?.toggleAttribute('disabled', $('redo').disabled);
  });
  $('undo').disabled = !history.canUndo;
  $('redo').disabled = !history.canRedo;
}
function restoreStep(r, word) {
  if (!r) return;
  stopNote();
  const selected = r.song.dots.some((d) => d.id === st.selected) ? st.selected : (r.song.dots[0]?.id ?? null);
  st = { ...r.song, selected, volume: st.volume };
  lastEdit = editKey(st);
  renderControls();
  renderTicks();
  render(true);
  refreshChord();
  persist();
  renderHistoryButtons();
  announce(word);
}
const undo = () => restoreStep(history.undo(), 'Undone');
const redo = () => restoreStep(history.redo(), 'Redone');

let saveTimer = 0;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* private mode: keep going */ }
}
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); };
/** Keep the change: one undo step, or merged into the last step while the same key repeats (a drag, a slider). */
const save = (key = null) => { record(key); persist(); };
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

const master = () => ({ sat: st.masterSat, light: st.masterLight });
const indexOf = (id) => st.dots.findIndex((d) => d.id === id);
const dotById = (id) => st.dots.find((d) => d.id === id);
const selectedDot = () => dotById(st.selected);
const snapActive = () => st.snap && !!getTuning(st.tuning).divisions;

function announce(msg) {
  const live = $('live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 20);
}

// ---------- Audio ----------

let ctx = null;
let sound = null;
let soundReady = null;
/** The one sound engine, made on the first gesture. Concurrent callers share one, so two clicks in a row never build two engines (a second engine can't stop the first one's notes). */
function ensureSound() {
  soundReady ??= unlockAudio().then((c) => {
    ctx = c;
    sound = createSound(ctx);
    sound.setMaster(M.masterGain(st.volume));
    return sound;
  });
  return soundReady.then(async (s) => {
    if (ctx.state !== 'running') await ctx.resume();
    return s;
  });
}

function specOf(dot) {
  const { freq } = M.pitchOf(dot);
  const s = M.soundOf(dot, master());
  return { freq, gain: s.gain, tone: s.tone, noise: s.noise, saturation: s.saturation };
}

let notePlaying = null; // id of the swatch sounding
async function playDot(dot, auto = false) {
  if (auto && chordOn) return; // a new color joins the held chord instead of sounding on its own
  await ensureSound();
  if (sound.playingLive) return; // a drag started while the sound engine was waking up: the drag has the floor
  notePlaying = dot.id;
  syncCards();
  sound.playNote(specOf(dot)).then(() => {
    if (notePlaying === dot.id) { notePlaying = null; syncCards(); }
  });
}
function stopNote() {
  sound?.stopNote();
  notePlaying = null;
  syncCards();
}

let chordOn = false;
function renderChordButton() {
  const b = $('chord');
  b.querySelector('.pr-icon').textContent = chordOn ? 'pause' : 'play_arrow';
  b.querySelector('.pr-btn__label').textContent = chordOn ? 'Pause chord' : 'Play chord';
  b.setAttribute('aria-label', chordOn ? 'Pause chord' : 'Play chord');
  b.disabled = st.dots.length === 0 && !chordOn;
}
async function toggleChord() {
  if (chordOn) {
    chordOn = false;
    sound?.stopChord();
  } else {
    if (!st.dots.length) return;
    await ensureSound();
    chordOn = true;
    sound.startChord(st.dots.map(specOf));
  }
  renderChordButton();
}
function refreshChord() {
  if (chordOn && sound) {
    if (!st.dots.length) {
      chordOn = false;
      sound.stopChord();
    } else if (!sound.updateChord(st.dots.map(specOf))) {
      sound.startChord(st.dots.map(specOf)); // a color was added or removed
    }
  }
  renderChordButton();
}
$('chord').addEventListener('click', toggleChord);
bindSpace(toggleChord);

// While a saturation or lightness slider moves, the selected note sounds and follows it.
let holding = false;
let liveTimer = 0;
async function liveHear(id) {
  const dot = dotById(id);
  if (!dot || chordOn) return;
  await ensureSound();
  if (sound.playingLive) sound.updateLive(specOf(dotById(id) ?? dot)); else sound.startLive(specOf(dotById(id) ?? dot));
  if (!holding) endLiveSoon(450); // a keyboard step: a short note, not a held one
  else clearTimeout(liveTimer);
}
function endLiveSoon(ms) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => sound?.endLive(), ms);
}
addEventListener('pointerup', () => { if (holding) { holding = false; endLiveSoon(0); } });

// ---------- Editing ----------

function apply(next, { rebuild = false, play = false } = {}) {
  if (!next) return;
  st = next;
  render(rebuild);
  if (play) {
    const d = selectedDot();
    if (d) playDot(d, true);
  }
  refreshChord();
  save();
}

function select(id) {
  if (st.selected === id) return;
  st = { ...st, selected: id };
  syncDots();
  syncCards();
  save();
}

function addDotAt(hue, radius) {
  const h2 = snapActive() ? M.snapHue(hue, st.tuning) : hue;
  const next = M.addDot(st, { hue: h2, sat: 100, light: M.lightFromRadius(radius) });
  if (!next) { announce('A palette has up to 12 colors'); return; }
  apply(next, { rebuild: true, play: true });
  const d = selectedDot();
  announce(`${M.dotName(d, indexOf(d.id))}, ${M.noteReadout(d, st.tuning).text}, ${Math.round(d.light)}% lightness, added`);
}

function removeDotId(id) {
  const i = indexOf(id);
  const name = M.dotName(dotById(id), i);
  const next = M.removeDot(st, id);
  if (!next) return;
  stopNoteIf(id);
  if (openId === id) openId = null;
  apply(next, { rebuild: true });
  announce(`${name} removed`);
  if (st.selected !== null) dotEls.get(st.selected)?.focus();
}
function stopNoteIf(id) { if (notePlaying === id) stopNote(); }

// ---------- The wheel ----------

const wheel = $('wheel');
const disc = $('disc');
const dotEls = new Map();

function renderTicks() {
  wheel.querySelectorAll('.pr-wheel__tick, .pr-wheel__label').forEach((el) => el.remove());
  for (const t of M.wheelTicks(st.tuning)) {
    wheel.append(h('span', { class: `pr-wheel__tick${t.named ? ' pr-wheel__tick--named' : ''}`, 'aria-hidden': 'true', style: `transform:rotate(${t.hue}deg)` }));
    if (t.label) {
      const p = M.polar(t.hue, 100);
      wheel.append(h('span', { class: 'pr-wheel__label', 'aria-hidden': 'true', style: `left:${50 + 47 * p.x}%;top:${50 + 47 * p.y}%`, text: t.label }));
    }
  }
}

function placeDot(el, dot) {
  const p = M.polar(dot.hue, M.radiusOfLight(dot.light));
  el.style.left = `${50 + 40 * p.x}%`;
  el.style.top = `${50 + 40 * p.y}%`;
  el.style.setProperty('--swatch', M.finalColor(dot, master()).hex);
}

function syncDots() {
  const wanted = new Set(st.dots.map((d) => d.id));
  for (const [id, el] of dotEls) if (!wanted.has(id)) { el.remove(); dotEls.delete(id); }
  st.dots.forEach((dot, i) => {
    let el = dotEls.get(dot.id);
    if (!el) {
      el = h('button', { class: 'pr-dot', type: 'button', 'data-id': String(dot.id) });
      el.addEventListener('pointerdown', (e) => onDotPointerDown(e, dot.id));
      el.addEventListener('keydown', (e) => onDotKey(e, dot.id));
      el.addEventListener('focus', () => select(dot.id));
      wheel.append(el);
      dotEls.set(dot.id, el);
    }
    placeDot(el, dot);
    el.setAttribute('aria-pressed', String(dot.id === st.selected));
    el.setAttribute('aria-label', M.describeDot(dot, i, st.tuning, master()));
  });
  // DOM order is swatch order, so Tab follows the swatches.
  const order = st.dots.map((d) => dotEls.get(d.id));
  const current = [...wheel.querySelectorAll('.pr-dot')];
  if (order.some((el, i) => el !== current[i])) for (const el of order) wheel.append(el);
  $('wheel-hint').textContent = st.dots.length ? 'Click the wheel to add a color' : 'Click the wheel to add your first color';
}

function updateWheelMaster() {
  // Master saturation grays the wheel (white at the center, mid-gray at the rim, like HSL gray);
  // master lightness washes it toward white, since the wheel shows the light half of lightness.
  wheel.style.setProperty('--gray', String(1 - st.masterSat / 100));
  wheel.style.setProperty('--lift', String(1 - st.masterLight / 100));
}

function offsetOf(e) {
  const r = disc.getBoundingClientRect();
  const radius = r.width / 2;
  return { x: (e.clientX - (r.left + radius)) / radius, y: (e.clientY - (r.top + radius)) / radius };
}

disc.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const { x, y } = offsetOf(e);
  if (Math.hypot(x, y) > 1) return;
  const { hue, radius } = M.fromOffset(x, y);
  e.preventDefault(); // keep the press from moving focus off the new dot
  const count = st.dots.length;
  addDotAt(hue, radius);
  if (st.dots.length > count) {
    dotEls.get(st.selected)?.focus(); // so the arrow keys move it at once
    onDotPointerDown(e, st.selected); // and holding on keeps dragging it, like any existing dot
  }
});

let drag = null;
function onDotPointerDown(e, id) {
  if (e.button !== 0) return;
  e.stopPropagation();
  select(id); // selecting never moves a dot; but a press that keeps going drags it at once, selected or not
  if (isPhone() && openId !== id) { openId = id; syncCards(); } // on a phone, a dot opens its swatch's details
  drag = { id, startX: e.clientX, startY: e.clientY, moved: false };
  addEventListener('pointermove', onDragMove);
  addEventListener('pointerup', onDragEnd, { once: true });
  addEventListener('pointercancel', onDragEnd, { once: true });
}

function onDragMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return; // a click never moves a dot
  if (!drag.moved) {
    drag.moved = true;
    if (notePlaying !== null) stopNote(); // the add chime gives way to the live note
    if (!chordOn) ensureSound().then(() => { if (drag?.moved && sound && !chordOn) sound.startLive(specOf(dotById(drag.id))); });
  }
  const dot = dotById(drag.id);
  const { x, y } = offsetOf(e);
  const to = M.dragTo(dot, x, y);
  const nextHue = snapActive() ? M.snapHue(to.hue, st.tuning) : to.hue;
  st = M.updateDot(st, drag.id, { hue: nextHue, light: to.light });
  syncDots();
  syncCards();
  if (chordOn) refreshChord(); // the dragged color's voice in the held chord follows the dot
  else if (sound?.playingLive) sound.updateLive(specOf(dotById(drag.id)));
}

function onDragEnd() {
  removeEventListener('pointermove', onDragMove);
  const d = drag;
  drag = null;
  if (d?.moved) {
    sound?.endLive(); // the note followed the dot; letting go releases it
    const dot = dotById(d.id);
    if (dot) { announce(`${M.noteReadout(dot, st.tuning).text}, ${Math.round(dot.light)}% lightness`); refreshChord(); save(); }
  }
}

function onDotKey(e, id) {
  const dot = dotById(id);
  if (!dot || e.metaKey || e.ctrlKey || e.altKey) return;
  const free = !getTuning(st.tuning).divisions;
  let patch = null;
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const hue = free || e.shiftKey ? dot.hue + dir * (free && e.shiftKey ? 0.1 : 1) : M.stepHue(dot.hue, st.tuning, dir);
      patch = { hue: ((hue % 360) + 360) % 360 };
      break;
    }
    case 'ArrowUp': patch = { light: M.stepLight(dot.light, 1, e.shiftKey ? 1 : 5) }; break; // out toward the true color
    case 'ArrowDown': patch = { light: M.stepLight(dot.light, -1, e.shiftKey ? 1 : 5) }; break; // in toward white
    case 'PageUp': patch = { sat: Math.min(100, dot.sat + 5) }; break;
    case 'PageDown': patch = { sat: Math.max(0, dot.sat - 5) }; break;
    case 'Enter':
      e.preventDefault();
      playDot(dot);
      return;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      removeDotId(id);
      return;
    default:
      return;
  }
  e.preventDefault();
  apply(M.updateDot(st, id, patch));
  const d = dotById(id);
  announce(`${M.dotName(d, indexOf(id))}, ${M.noteReadout(d, st.tuning).text}, ${Math.round(d.sat)}% saturation, ${Math.round(d.light)}% lightness`);
  playDot(d, true); // every key that changes the color (hue, lightness, saturation) auditions it
}

// ---------- Swatch cards ----------

const swatches = $('swatches');
const cards = new Map(); // id -> { root, refs }
let cardSignature = '';

function field(label, control, { wide = false } = {}) {
  return h('label', { class: `pr-field${wide ? ' pc-wide' : ''}` }, label, control);
}

function copyRow(label, key, onCommit) {
  const input = h('input', { class: 'pr-input', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': label });
  input.addEventListener('change', () => onCommit(input.value));
  const status = h('span', { class: 'pc-copied', 'aria-hidden': 'true' });
  const btn = h('button', { class: 'pr-dense pr-hit', type: 'button', 'aria-label': `Copy ${label}` }, icon('content_copy'));
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(input.value); } catch { /* clipboard blocked */ }
    status.textContent = 'Copied';
    announce(`Copied ${input.value}`);
    setTimeout(() => { status.textContent = ''; }, 1500);
  });
  return { input, row: h('div', { class: 'pr-field' }, h('span', {}, label, ' ', status), h('div', { class: 'pc-fieldrow' }, input, btn)) };
}

function buildCard(dot, index) {
  const id = dot.id;
  const refs = {};
  refs.title = h('h3', { class: 'pr-swcard__name' });
  refs.tag = h('span', { class: 'pc-numtag' });
  refs.rename = h('button', { class: 'pr-dense pr-hit', type: 'button' }, icon('edit'));
  refs.rename.addEventListener('click', () => startRename(id));
  const iconBtn = (name, label, onclick) => {
    const b = h('button', { class: 'pr-dense pr-hit', type: 'button', 'aria-label': label }, icon(name));
    b.addEventListener('click', onclick);
    return b;
  };
  refs.up = iconBtn('arrow_upward', 'Move up', () => moveBy(id, -1));
  refs.down = iconBtn('arrow_downward', 'Move down', () => moveBy(id, 1));
  refs.dup = iconBtn('library_add', 'Duplicate', () => {
    const next = M.duplicateDot(st, id);
    if (!next) { announce('A palette has up to 12 colors'); return; }
    apply(next, { rebuild: true });
    announce('Duplicated');
  });
  refs.remove = iconBtn('close', 'Remove', () => removeDotId(id));

  refs.chip = h('button', { class: 'pr-chip pc-chip', type: 'button' }, icon('play_arrow'));
  refs.chip.addEventListener('click', () => {
    select(id);
    if (notePlaying === id) stopNote(); else playDot(dotById(id));
  });

  refs.note = h('div', { class: 'pc-readonly' });
  refs.octave = h('input', { class: 'pr-input pc-octave', type: 'number', min: String(M.MIN_OCTAVE), max: String(M.MAX_OCTAVE), step: '1' });
  refs.octave.addEventListener('change', () => {
    const v = Math.round(Number(refs.octave.value));
    if (Number.isFinite(v)) apply(M.updateDot(st, id, { octave: Math.max(M.MIN_OCTAVE, Math.min(M.MAX_OCTAVE, v)) }), { play: false });
    syncCards(true);
  });
  refs.lightInfo = h('div', { class: 'pc-readonly' });

  const commitColor = (parse) => (text) => {
    const hsl = parse(text);
    const d = dotById(id);
    if (!hsl || !d) { syncCards(true); return; }
    apply(M.updateDot(st, id, { hue: hsl.h, sat: M.ownSatFromFinal(hsl.s, st.masterSat), light: M.ownLightFromFinal(hsl.l, st.masterLight) }));
  };
  const hsl = copyRow('HSL', 'hsl', commitColor((t) => M.parseHsl(t)));
  const rgb = copyRow('RGB', 'rgb', commitColor((t) => { const c = M.parseRgb(t); return c && rgbToHsl(...c); }));
  const hex = copyRow('Hex', 'hex', commitColor((t) => { const c = M.parseHex(t); return c && rgbToHsl(...c); }));
  Object.assign(refs, { hsl: hsl.input, rgb: rgb.input, hex: hex.input });

  refs.sat = h('input', { class: 'pr-range', type: 'range', min: '0', max: '100', step: '1' });
  refs.satVal = h('span', { class: 'pc-sliderval' });
  refs.light = h('input', { class: 'pr-range', type: 'range', min: '0', max: '100', step: '1' });
  refs.lightVal = h('span', { class: 'pc-sliderval' });
  for (const [ref, key] of [[refs.sat, 'sat'], [refs.light, 'light']]) {
    ref.addEventListener('input', () => {
      st = M.updateDot(st, id, { [key]: Number(ref.value) });
      render(false);
      refreshChord();
      save(`${key}-${id}`);
      liveHear(id); // hear what the slider does to the note while you drag it
    });
    ref.addEventListener('pointerdown', () => { holding = true; });
    ref.addEventListener('change', () => { holding = false; history.seal(); endLiveSoon(0); });
  }

  // Phones: each card is a row in the list (chip, name, note and Hz, hex); tapping it opens the card's details.
  refs.rowChip = h('span', { class: 'pc-row__chip', 'aria-hidden': 'true' });
  refs.rowName = h('strong', { class: 'pc-row__name' });
  refs.rowSub = h('span', { class: 'pc-row__sub' });
  refs.rowHex = h('span', { class: 'pc-row__hex' });
  refs.row = h('button', { class: 'pc-row pr-phone-only', type: 'button', onclick: () => openSwatch(id) },
    refs.rowChip, h('span', { class: 'pc-row__text' }, refs.rowName, refs.rowSub), refs.rowHex, icon('chevron_right'));
  refs.back = h('button', { class: 'pc-back pr-phone-only', type: 'button', 'aria-label': 'Back to all swatches', onclick: () => closeSwatch() }, icon('arrow_back'));
  refs.miniChip = h('span', { class: 'pc-minichip pr-phone-only', 'aria-hidden': 'true' });
  refs.play = h('button', { class: 'pc-play pr-phone-only', type: 'button', onclick: () => refs.chip.click() }, icon('play_arrow'));
  const act = (name, label, ref) => h('button', { class: 'pc-act', type: 'button', onclick: () => ref.click() }, icon(name), label);
  refs.acts = h('div', { class: 'pc-acts pr-phone-only' },
    act('arrow_upward', 'Move up', refs.up), act('arrow_downward', 'Move down', refs.down),
    act('library_add', 'Duplicate', refs.dup), act('delete', 'Remove', refs.remove));

  const root = h('article', { class: 'pr-swcard', 'data-id': String(id) },
    refs.row,
    h('div', { class: 'pr-swcard__head' }, refs.back, refs.miniChip, refs.title, refs.tag, refs.rename, h('span', { class: 'pr-swcard__headspacer' }),
      h('span', { class: 'pc-headbtns pr-desk-only' }, refs.up, refs.down, refs.dup, refs.remove), refs.play),
    h('div', { class: 'pr-swcard__body' }, refs.chip, h('div', { class: 'pr-swcard__fields' },
      field('Note', refs.note), field('Octave', refs.octave), field('Pitch · Light', refs.lightInfo),
      hsl.row, rgb.row, hex.row,
      h('label', { class: 'pr-field pc-wide' }, h('span', {}, 'Saturation ', refs.satVal), refs.sat),
      h('label', { class: 'pr-field pc-wide' }, h('span', {}, 'Lightness ', refs.lightVal), refs.light))),
    refs.acts);

  root.addEventListener('click', (e) => { if (!e.target.closest('button, input')) select(id); });
  root.addEventListener('focusin', (e) => { if (e.target.closest('input, button')) select(id); });
  return { root, refs };
}

function openSwatch(id) {
  select(id);
  openId = id;
  syncCards();
  cards.get(id)?.refs.back.focus();
}
function closeSwatch() {
  const id = openId;
  openId = null;
  syncCards();
  cards.get(id)?.refs.row.focus();
}

function moveBy(id, dir) {
  const next = M.moveDot(st, id, indexOf(id) + dir);
  if (!next) return;
  apply(next, { rebuild: true });
  announce(`Moved to position ${indexOf(id) + 1}`);
  cards.get(id)?.refs[dir < 0 ? 'up' : 'down'].focus();
}

function startRename(id) {
  const c = cards.get(id);
  const dot = dotById(id);
  const input = h('input', { class: 'pc-rename', type: 'text', maxlength: '32', value: dot.name ?? '', placeholder: M.dotName({ name: null }, indexOf(id)), 'aria-label': 'Swatch name' });
  let done = false;
  const finish = (saveIt) => {
    if (done) return;
    done = true;
    if (saveIt) apply(M.renameDot(st, id, input.value), { rebuild: true });
    else render(true);
    cards.get(id)?.refs.rename.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  c.refs.title.replaceWith(input);
  input.focus();
}

function syncCards(force = false) {
  const signature = st.dots.map((d) => `${d.id}:${d.name ?? ''}`).join('|');
  if (signature !== cardSignature) {
    cardSignature = signature;
    cards.clear();
    swatches.replaceChildren();
    st.dots.forEach((dot, i) => {
      const c = buildCard(dot, i);
      cards.set(dot.id, c);
      swatches.append(c.root);
    });
  }
  const m = master();
  st.dots.forEach((dot, i) => {
    const { root, refs } = cards.get(dot.id);
    const c = M.finalColor(dot, m);
    const selected = dot.id === st.selected;
    root.classList.toggle('is-selected', selected);
    refs.title.textContent = M.dotName(dot, i);
    refs.tag.textContent = dot.name ? `#${i + 1}` : '';
    refs.rename.setAttribute('aria-label', `Rename ${M.dotName(dot, i)}`);
    refs.up.disabled = i === 0;
    refs.down.disabled = i === st.dots.length - 1;
    refs.dup.disabled = st.dots.length >= M.MAX_DOTS;
    [refs.up, refs.down, refs.dup, refs.remove].forEach((b, k) => { refs.acts.children[k].disabled = b.disabled; });
    const playingThis = notePlaying === dot.id;
    refs.chip.style.setProperty('--swatch', c.hex);
    refs.chip.style.setProperty('--chip-fg', c.label);
    refs.chip.querySelector('.pr-icon').textContent = playingThis ? 'pause' : 'play_arrow';
    refs.chip.setAttribute('aria-label', `${playingThis ? 'Pause' : 'Play'} ${M.dotName(dot, i)}`);
    const note = M.noteReadout(dot, st.tuning);
    refs.note.textContent = note.step ? `${note.text} · ${note.step}` : note.text;
    setIdle(refs.octave, String(dot.octave), force);
    refs.lightInfo.textContent = `${note.hz < 100 ? note.hz.toFixed(2) : note.hz.toFixed(1)} Hz · ${M.lightReadout(dot)}`;
    setIdle(refs.hsl, M.formatHsl(c.h, c.s, c.l), force);
    setIdle(refs.rgb, M.formatRgb(c.rgb), force);
    setIdle(refs.hex, c.hex, force);
    refs.sat.value = String(Math.round(dot.sat));
    refs.light.value = String(Math.round(dot.light));
    refs.satVal.textContent = st.masterSat < 100 ? `${Math.round(dot.sat)}% → ${Math.round(c.s)}%` : `${Math.round(dot.sat)}%`;
    const dbv = lightnessToDb(c.l);
    const db = dbv === -Infinity ? `${MINUS}∞ dB` : `${dbv === 0 ? '0.0' : MINUS + Math.abs(dbv).toFixed(1)} dB`;
    refs.lightVal.textContent = `${st.masterLight < 100 ? `${Math.round(dot.light)}% → ${Math.round(c.l)}%` : `${Math.round(dot.light)}%`} · ${db}`;
    refs.rowChip.style.background = c.hex;
    refs.miniChip.style.background = c.hex;
    refs.rowName.textContent = M.dotName(dot, i);
    refs.rowSub.textContent = `${note.text} · ${note.hz < 100 ? note.hz.toFixed(2) : note.hz.toFixed(1)} Hz`;
    refs.rowHex.textContent = c.hex;
    refs.row.setAttribute('aria-label', `${M.dotName(dot, i)}, ${note.text}, ${c.hex}. Open details`);
    refs.play.querySelector('.pr-icon').textContent = playingThis ? 'pause' : 'play_arrow';
    refs.play.setAttribute('aria-label', `${playingThis ? 'Pause' : 'Play'} this color`);
    root.classList.toggle('is-open', dot.id === openId);
    refs.sat.setAttribute('aria-label', `Saturation of ${M.dotName(dot, i)}`);
    refs.light.setAttribute('aria-label', `Lightness of ${M.dotName(dot, i)}`);
  });
  if (openId !== null && !cards.has(openId)) openId = null;
  $('main').classList.toggle('has-open', openId !== null);
  $('empty').hidden = st.dots.length > 0;
  $('count').textContent = `${st.dots.length} of ${M.MAX_DOTS} colors`;
  $('count-top').textContent = `${st.dots.length} of ${M.MAX_DOTS}`;
  $('add').disabled = st.dots.length >= M.MAX_DOTS;
}

function setIdle(input, value, force) {
  if (force || document.activeElement !== input) input.value = value;
}

// ---------- Rendering ----------

function render(rebuildCards = false) {
  updateWheelMaster();
  syncDots();
  if (rebuildCards) cardSignature = '\u0000';
  syncCards();
  renderChordButton();
  $('msat').value = String(st.masterSat);
  $('mbri').value = String(st.masterLight);
  // On a phone the slider's own label already names it: "100% · noise 0%", "range 100% · 0.0 dB".
  const short = (t) => (isPhone() ? t.replace(/^(Saturation|Lightness) /, '') : t);
  $('msat-read').textContent = short(M.saturationReadout(st.masterSat));
  $('mbri-read').textContent = short(M.masterLightnessReadout(st.masterLight));
  updateAddHint();
}

function renderControls() {
  const free = !getTuning(st.tuning).divisions;
  $('tuning').value = st.tuning;
  const sw = $('snap');
  sw.setAttribute('aria-checked', String(!st.snap || free));
  sw.disabled = free;
  $('snap-off').classList.toggle('is-disabled', free);
  $('snap-on').classList.toggle('is-disabled', free);
  $('volume').value = String(st.volume);
}

$('tuning').append(...TUNINGS.map((t) => h('option', { value: t.id, text: t.label })));
const confirmOnce = createConfirmOnce({ prefix: 'polycolor', ask: ({ title, text, ok }) => confirmDialog(title, text, ok) });

/** Move every color to its nearest note of a tuning. Asks the first time, since colors change. false if declined. */
async function snapToTuning(tuningId, snapOn) {
  let nextState = { ...st, tuning: tuningId, snap: snapOn };
  if (snapOn && getTuning(tuningId).divisions) {
    const { state, moved } = M.snapAll(nextState, tuningId);
    if (moved) {
      const label = getTuning(tuningId).label;
      const yes = await confirmOnce('snap', {
        title: `Snap to ${label}?`,
        text: `${moved === 1 ? '1 color' : `${moved} colors`} will move to the nearest ${label} note, because Snap to notes is on.`,
        ok: 'Snap colors',
      });
      if (!yes) return false;
      nextState = state;
    }
  }
  stopNote();
  st = nextState;
  renderControls();
  renderTicks();
  render(true);
  refreshChord();
  save();
  return true;
}

$('tuning').addEventListener('change', async (e) => {
  if (!(await snapToTuning(e.target.value, st.snap))) e.target.value = st.tuning;
});

$('snap').addEventListener('click', async () => {
  if ($('snap').disabled) return;
  const on = !st.snap;
  if (await snapToTuning(st.tuning, on)) announce(on ? 'Snap to notes' : 'Microtonal');
});

$('volume').addEventListener('input', (e) => {
  st = { ...st, volume: Number(e.target.value) };
  sound?.setMaster(M.masterGain(st.volume));
  save();
});

for (const [id, key] of [['msat', 'masterSat'], ['mbri', 'masterLight']]) {
  $(id).addEventListener('input', (e) => { st = { ...st, [key]: Number(e.target.value) }; render(false); refreshChord(); save(`master-${key}`); liveHear(st.selected); });
  $(id).addEventListener('pointerdown', () => { holding = true; });
  $(id).addEventListener('change', () => { holding = false; history.seal(); endLiveSoon(0); });
}

// ---------- Add color, New palette ----------

function updateAddHint() {
  const left = M.MAX_DOTS - st.dots.length;
  $('add-hint').textContent = `paste several hex codes to add a palette · ${left} more fit`;
}

$('add').addEventListener('click', () => {
  const form = $('add-form');
  form.hidden = !form.hidden;
  $('add').setAttribute('aria-expanded', String(!form.hidden));
  if (!form.hidden) $('add-input').focus();
});
$('add-cancel').addEventListener('click', () => { $('add-form').hidden = true; $('add').setAttribute('aria-expanded', 'false'); $('add').focus(); });
$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('add-input').value;
  const hsl = M.parseHsl(text);
  const rgb = M.parseRgb(text);
  let rgbs = [];
  if (hsl) rgbs = [hslToRgb(hsl.h, hsl.s, hsl.l)];
  else if (rgb) rgbs = [rgb];
  else rgbs = M.parsePalette(text);
  if (!rgbs.length) { $('add-hint').textContent = 'That isn’t a color I can read. Try #FF8C00, rgb(255 140 0) or 28°, 80%, 100%.'; return; }
  const { state, added, dropped } = M.addPalette(st, rgbs);
  if (!added) { announce('A palette has up to 12 colors'); return; }
  apply(state, { rebuild: true });
  $('add-input').value = '';
  announce(`Added ${added} color${added > 1 ? 's' : ''}${dropped ? `, ${dropped} didn’t fit` : ''}`);
  const d = selectedDot();
  if (d) playDot(d, true);
});
const dialog = $('dialog');
function confirmDialog(title, text, ok) {
  return new Promise((resolve) => {
    $('dialog-title').textContent = title;
    $('dialog-text').textContent = text;
    $('dialog-ok').textContent = ok;
    const ac = new AbortController();
    const done = (v) => { ac.abort(); if (dialog.open) dialog.close(); resolve(v); };
    $('dialog-form').addEventListener('submit', (e) => { e.preventDefault(); done(true); }, { signal: ac.signal });
    $('dialog-cancel').addEventListener('click', () => done(false), { signal: ac.signal });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(false); }, { signal: ac.signal });
    dialog.showModal();
    $('dialog-ok').focus();
  });
}

$('new').addEventListener('click', async () => {
  if (st.dots.length && !(await confirmOnce('new-palette', { title: 'Start a new palette?', text: 'This clears all the colors on the wheel.', ok: 'New palette' }))) return;
  stopNote();
  apply(M.newPalette(st), { rebuild: true });
  announce('New palette');
});

// ---------- Export: the swatch card ----------

async function exportCard() {
  if (!st.dots.length) { announce('Add a color first'); return; }
  const dots = st.dots;
  const per = dots.length > 6 ? Math.ceil(dots.length / 2) : dots.length;
  const rows = Math.ceil(dots.length / per);
  const W = 1600, pad = 64, gap = 24, headH = 150, blockH = 520, footH = 90;
  const H = headH + rows * blockH + (rows - 1) * gap + footH + pad;
  const scale = 2;
  await Promise.all([
    document.fonts.load('700 28px "IBM Plex Mono"'),
    document.fonts.load('500 22px "IBM Plex Mono"'),
    document.fonts.load('600 26px "IBM Plex Sans"'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, 4);

  // Brand: Poly and the wordmark, from the page's own inline SVG.
  const polySvg = document.querySelector('.pr-logo .poly');
  if (polySvg) {
    const xml = new XMLSerializer().serializeToString(polySvg);
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`; });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, pad, 36, 68, 68);
  }
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  g.font = '700 34px "IBM Plex Mono", monospace';
  g.fillText('polycolor', pad + 88, 82);
  g.font = '500 20px "IBM Plex Mono", monospace';
  g.fillText('polyrhythmic.design/polycolor', pad + 88, 112);

  const bw = (W - pad * 2 - gap * (per - 1)) / per;
  dots.forEach((dot, i) => {
    const row = Math.floor(i / per);
    const col = i % per;
    const x = pad + col * (bw + gap);
    const y = headH + row * (blockH + gap);
    const c = M.finalColor(dot, master());
    g.fillStyle = c.hex;
    g.fillRect(x, y, bw, blockH - 190);
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.strokeRect(x, y, bw, blockH - 190);
    const note = M.noteReadout(dot, st.tuning);
    g.fillStyle = c.label;
    g.font = '600 30px "IBM Plex Mono", monospace';
    g.fillText(note.text.replace(/ [+−]\d+¢$/, ''), x + 16, y + blockH - 190 - 18);
    g.fillStyle = '#000';
    const fit = (text, size, weight, family, maxW) => {
      let s = size;
      do { g.font = `${weight} ${s}px ${family}`; s -= 1; } while (g.measureText(text).width > maxW && s > 10);
    };
    let ty = y + blockH - 190 + 34;
    const lines = [];
    if (dot.name) lines.push([dot.name, '600', '"IBM Plex Sans", sans-serif', 26]);
    lines.push([c.hex, '600', '"IBM Plex Mono", monospace', 24]);
    lines.push([M.formatRgb(c.rgb), '500', '"IBM Plex Mono", monospace', 20]);
    lines.push([`HSL ${M.formatHsl(c.h, c.s, c.l)}`, '500', '"IBM Plex Mono", monospace', 20]);
    lines.push([note.text + (note.step ? ` · ${note.step}` : ''), '500', '"IBM Plex Mono", monospace', 20]);
    for (const [text, weight, family, size] of lines) {
      fit(text, size, weight, family, bw - 8);
      g.fillText(text, x, ty);
      ty += size + 12;
    }
  });
  g.fillStyle = '#000';
  g.fillRect(0, H - 4, W, 4);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `polycolor-palette-${stamp}.png` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Swatch card exported');
}
$('export').addEventListener('click', exportCard);

// ---------- Phones (spec, Layout: Phones) ----------
// The rail (Add, Undo, Redo, Menu), the Add drawer holding the add-by-value form, and the Menu.

const fullscreen = fullscreenControls();
const phone = createPhoneFrame({
  app: 'polycolor',
  menuAria: 'Menu: palette, export and sound',
  tools: [
    { id: 'add', icon: 'add_box', label: 'Add', aria: 'Add colors by value' },
    { id: 'undo', icon: 'undo', label: 'Undo', onClick: () => undo() },
    { id: 'redo', icon: 'redo', label: 'Redo', onClick: () => redo() },
    fullscreen.tool,
  ].filter(Boolean),
});
const addDrawer = phone.drawer('add', { label: 'Add colors by value' });
const menu = phone.drawer('menu', { label: 'Menu', title: 'polycolor', wide: true });
const phoneVolume = h('input', { class: 'pr-range', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Master volume' });
phoneVolume.addEventListener('input', () => { $('volume').value = phoneVolume.value; $('volume').dispatchEvent(new Event('input')); });
const run = (fn) => () => { phone.close(); fn(); };
menu.body.append(
  h('div', { class: 'pc-mspace' }),
  menuItem({ icon: 'image', label: 'Export swatch card', hint: '.png', onClick: run(exportCard) }),
  menuItem({ icon: 'add_box', label: 'Add colors by value', onClick: () => phone.open('add') }),
  menuItem({ icon: 'restart_alt', label: 'New palette', onClick: run(() => $('new').click()) }),
  h('label', { class: 'pc-mrow' }, h('span', { text: 'Master volume' }), phoneVolume),
  fullscreen.row,
  menuFooter('polycolor'),
);
addEventListener('drawerchange', (e) => {
  if (e.detail === 'menu') phoneVolume.value = String(st.volume);
  if (e.detail === 'add') { updateAddHint(); $('add-input').focus(); }
});

/** The add form lives in the Add drawer on a phone, and under the swatch panel's buttons on a desktop. */
function placeAddForm() {
  const form = $('add-form');
  if (isPhone()) { addDrawer.body.append(form); form.hidden = false; }
  else if (form.parentElement !== $('main').querySelector('.pc-right')) { $('main').querySelector('.pc-right__head').after(form); form.hidden = true; }
}
$('add-cancel').addEventListener('click', () => { if (isPhone()) phone.close(); });
$('add-form').addEventListener('submit', () => { if (isPhone() && !$('add-input').value) phone.close(); });
onPhoneChange(() => { openId = null; placeAddForm(); render(true); });
placeAddForm();

// ---------- Start ----------

renderControls();
renderTicks();
render(true);

$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
renderHistoryButtons();
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (e.target.closest?.('input[type="text"], input[type="number"], textarea, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
});

bindShortcuts({ trigger: $('shortcuts-link'), groups: [
  ['Anywhere', [
    ['Space', 'Play or pause the chord'],
    ['⌘Z  /  ⇧⌘Z', 'Undo and redo'],
    ['?', 'Show this list'],
  ]],
  ['On a color', [
    ['Tab', 'Move between colors'],
    ['← →', 'Rotate one note (⇧ one degree)'],
    ['↑ ↓', 'Lightness: out toward the true color, in toward white (⇧ finer)'],
    ['Page Up / Page Down', 'Saturation'],
    ['Enter', 'Play the color'],
    ['Delete', 'Remove the color'],
  ]],
] });
