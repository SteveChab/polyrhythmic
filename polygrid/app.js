// polygrid app: DOM and wiring. Logic lives in model.js, sound in sound.js.

import * as M from './model.js';
import { createSound } from './sound.js';
import { TUNINGS, getTuning } from '../shared/tuning.js';
import { noteColor, rgbToHex, labelInk } from '../shared/color.js';
import { getAudioContext, unlockAudio, heardTime, createFrameLoop } from '../shared/clock.js';
import { bindPlayPause, bindSwitch } from '../shared/ui.js';
import { bindShortcuts } from '../shared/shortcuts.js';
import { isPhone, onPhoneChange, createPhoneFrame, buildRotateScreen, menuFooter } from '../shared/phone.js';

const $ = (id) => document.getElementById(id);
const STORE = 'polygrid:state';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- State ----------

let state = (() => {
  try { return M.restoreState(JSON.parse(localStorage.getItem(STORE))); }
  catch { return M.restoreState(null); }
})();

let saveTimer = 0;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode: keep going */ }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

const rawHz = () => M.sliderToHz(state.slider);
const hz = () => M.effectiveHz(rawHz(), state.beats, { snap: snapActive(), tuning: state.tuning });
const snapActive = () => state.snap && !!getTuning(state.tuning).divisions;

let sound = null; // made on the first Play, inside the click

// ---------- Static pieces ----------

$('tuning').innerHTML = TUNINGS.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');

const scale = $('scale');
for (const t of M.TICKS) {
  const left = M.hzToPercent(t.hz);
  const tf = left === 0 ? 'none' : left === 100 ? 'translateX(-100%)' : 'translateX(-50%)';
  scale.insertAdjacentHTML('beforeend',
    `<div class="pg-tick" style="left:${left}%"></div><div class="pg-tick__label" style="left:${left}%;transform:${tf}">${t.label}</div>`);
}
const fuseMarks = [0, 1, 2].map((r) => {
  const el = document.createElement('div');
  el.className = 'pg-fuse';
  el.textContent = String(r + 1);
  scale.append(el);
  return el;
});

// ---------- Rows: built once, cells rebuilt only when a beat count changes ----------

// Each row's tick: low, mid and high (spec 2.3).
const TICK_NAMES = ['Low tick', 'Mid tick', 'High tick'];

const rows = [0, 1, 2].map((r) => {
  const name = M.ROW_NAMES[r];
  const head = document.createElement('div');
  head.className = 'pg-rowhead';
  head.innerHTML = `
    <button class="pg-rowname pr-phone-only" type="button"><strong>${name}</strong><span>${TICK_NAMES[r]}</span></button>
    <div class="pg-rowhead__top">
      <h3 class="pg-rowhead__name">${name}</h3><span class="pg-rowhead__tick">${TICK_NAMES[r]}</span>
      <button class="pr-dense pg-dense pg-mute" type="button" data-act="mute" aria-pressed="false" aria-label="Mute ${name}">M</button>
      <button class="pr-dense pg-dense" type="button" data-act="dec" aria-label="Fewer beats in ${name}">−</button>
      <input class="pr-input pg-beats-input" type="number" inputmode="numeric" min="0" max="25" step="1" aria-label="${name} beats, 0 to 25">
      <button class="pr-dense pg-dense" type="button" data-act="inc" aria-label="More beats in ${name}">+</button>
    </div>
    <div class="pg-rowhead__vol"><span aria-hidden="true">Vol</span>
      <input class="pr-range" type="range" min="-60" max="0" step="0.5" aria-label="${name} volume">
      <span class="pg-rowhead__db tabnum" aria-hidden="true"></span>
    </div>`;
  $('headers').append(head);

  const strip = document.createElement('div');
  strip.className = 'pg-strip';
  strip.setAttribute('role', 'img');
  strip.innerHTML = `
    <div class="pg-cells"></div>
    <div class="pg-under" aria-hidden="true"><div class="pg-under__bar"></div></div>
    <div class="pg-band"><span class="pg-band__note"></span><span class="pg-band__hz"></span></div>
    <div class="pg-off">Off · set Beats above 0 to add this row</div>`;
  $('strips').append(strip);

  const q = (s) => head.querySelector(s);
  const row = {
    head, strip,
    mute: q('[data-act="mute"]'), dec: q('[data-act="dec"]'), inc: q('[data-act="inc"]'),
    beats: q('.pg-beats-input'), vol: q('.pr-range'), db: q('.pg-rowhead__db'),
    cells: strip.querySelector('.pg-cells'), bar: strip.querySelector('.pg-under__bar'),
    bandNote: strip.querySelector('.pg-band__note'), bandHz: strip.querySelector('.pg-band__hz'),
    builtFor: -1, lastIndex: -1,
    nameBtn: q('.pg-rowname'), volRow: q('.pg-rowhead__vol'),
  };
  row.nameBtn.addEventListener('click', () => openRowSheet(r));

  row.mute.addEventListener('click', () => { state.mute[r] = !state.mute[r]; changed(); });
  row.dec.addEventListener('click', () => setBeats(r, state.beats[r] - 1));
  row.inc.addEventListener('click', () => setBeats(r, state.beats[r] + 1));
  row.beats.addEventListener('change', () => setBeats(r, row.beats.value));
  row.beats.addEventListener('keydown', (e) => {
    // Arrows step the count right away, without waiting for change.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setBeats(r, state.beats[r] + (e.key === 'ArrowUp' ? 1 : -1));
    }
  });
  row.vol.addEventListener('input', () => { state.db[r] = Number(row.vol.value); changed(); });
  return row;
});

function setBeats(r, n) {
  const v = M.clampBeats(n);
  if (v !== state.beats[r]) { state.beats[r] = v; state.preset = null; }
  rows[r].beats.value = v;
  changed();
}

// ---------- Preset menu ----------

const presetBtn = $('preset-btn');
const menu = $('preset-menu');

function buildMenu() {
  menu.innerHTML = '';
  for (const g of M.presetGroups(state.tuning)) {
    const group = document.createElement('div');
    group.className = 'pg-menu__group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', g.title);
    group.innerHTML = `<div class="pr-eyebrow pg-menu__title" aria-hidden="true">${g.title}</div>${g.note ? `<div class="pg-menu__note">${g.note}</div>` : ''}`;
    for (const { preset, meta } of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pr-menu-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(state.preset === preset.id));
      b.tabIndex = -1;
      b.innerHTML = `<span class="pr-icon" aria-hidden="true">check</span><span class="pg-menu__name">${preset.name}</span><span class="pr-menu-item__meta">${meta}</span>`;
      b.addEventListener('click', () => {
        state.beats = preset.rows.slice();
        state.preset = preset.id;
        closeMenu(true);
        changed();
      });
      group.append(b);
    }
    menu.append(group);
  }
  menu.insertAdjacentHTML('beforeend', '<div class="pg-menu__foot">Editing any row switches to Custom.</div>');
}

const items = () => [...menu.querySelectorAll('[role="menuitemradio"]')];

function openMenu(focusLast = false) {
  buildMenu();
  menu.hidden = false;
  presetBtn.setAttribute('aria-expanded', 'true');
  const list = items();
  const target = focusLast ? list.at(-1) : list.find((b) => b.getAttribute('aria-checked') === 'true') ?? list[0];
  target.focus();
}

function closeMenu(refocus) {
  if (menu.hidden) return;
  menu.hidden = true;
  presetBtn.setAttribute('aria-expanded', 'false');
  if (refocus) presetBtn.focus();
}

presetBtn.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu(false)));
presetBtn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(e.key === 'ArrowUp'); }
});
menu.addEventListener('keydown', (e) => {
  const list = items();
  const i = list.indexOf(document.activeElement);
  const go = (j) => { e.preventDefault(); list[(j + list.length) % list.length].focus(); };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(list.length - 1);
  else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
  else if (e.key === 'Tab') closeMenu(false);
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !presetBtn.contains(e.target)) closeMenu(false);
});

// ---------- Top bar controls ----------

$('tuning').addEventListener('change', (e) => { state.tuning = e.target.value; changed(); });
const snapSwitch = bindSwitch($('snap'), (on) => { state.snap = on; changed(); });
$('master').addEventListener('input', (e) => { state.master = Number(e.target.value); changed(); });
$('speed').addEventListener('input', (e) => { state.slider = Number(e.target.value); changed(); });

// ---------- Drawing (only on change, never per beat) ----------

let gridCols = -1;
let pageGridCols = -1;
const PAGE_MAX_COLUMNS = 120; // past this the figure's faint grid is just gray

function render() {
  const cycleHz = hz();
  const tuning = getTuning(state.tuning);
  const counts = M.activeCounts(state.beats);
  const L = M.gridColumns(state.beats);
  const lowN = counts.length ? Math.min(...counts) : 0;

  // Top bar
  const preset = M.presetById(state.preset);
  $('preset-name').textContent = preset ? preset.name : 'Custom';
  presetBtn.setAttribute('aria-label', `Preset: ${preset ? preset.name : 'Custom'}`);
  $('tuning').value = state.tuning;
  snapSwitch.set(snapActive());
  $('snap').disabled = !tuning.divisions;
  $('snap-label').classList.toggle('is-disabled', !tuning.divisions);
  $('master').value = state.master;

  // Headline: the ratio, what it sounds like, and the grid it makes.
  $('ratio').textContent = counts.length ? counts.join(' : ') : '—';
  $('sounds').textContent = counts.length ? M.soundsText(preset, state.tuning) : 'No rows are on';
  $('grid-text').textContent = isPhone()
    ? (L ? `${L.toLocaleString('en-US')}-column grid${L > M.DRAW_MAX_COLUMNS ? ' · too fine to draw' : ''}` : '')
    : M.gridText(state.beats) + (L > M.DRAW_MAX_COLUMNS ? ' Too fine to draw.' : '');

  // Rows
  state.beats.forEach((n, r) => {
    const row = rows[r];
    const rate = n * cycleHz;
    const muted = state.mute[r];
    const mode = !n ? 'off' : rate >= M.FUSE_RATE ? 'band' : 'cells';
    row.strip.dataset.mode = mode;
    row.strip.classList.toggle('is-muted', muted);
    row.mute.setAttribute('aria-pressed', String(muted));
    if (document.activeElement !== row.beats) row.beats.value = n;
    row.dec.disabled = n <= 0;
    row.inc.disabled = n >= M.MAX_BEATS;
    row.vol.value = state.db[r];
    row.vol.setAttribute('aria-valuetext', M.dbText(state.db[r]));
    row.db.textContent = M.dbText(state.db[r]);
    row.nameBtn.setAttribute('aria-label', `${M.ROW_NAMES[r]}, ${TICK_NAMES[r]}, volume ${M.dbText(state.db[r])}. Row settings`);

    if (row.builtFor !== n) {
      row.cells.style.setProperty('--beats', Math.max(n, 1));
      row.bar.style.setProperty('--beats', Math.max(n, 1));
      row.cells.innerHTML = Array.from({ length: n }, (_, i) => `<div class="pg-cell"><span>${i + 1}</span></div>`).join('');
      row.builtFor = n;
      row.lastIndex = -1;
    }

    // Color: hue from the row's pitch, brightness from its volume; fades in from 3 to 20 beats a second.
    if (n) {
      const c = noteColor(rate, { db: state.db[r] });
      const t = M.colorAmount(rate);
      const mix = c.rgb.map((v) => Math.round(255 + (v - 255) * t));
      const fill = mode === 'band' ? c.hex : rgbToHex(...mix);
      row.strip.style.setProperty('--fill', fill);
      row.strip.style.setProperty('--fill-ink', labelInk(...hexRgb(fill)));
      // The band carries what the Notes list used to: note, Hz, and in 19, 24 and 31-EDO the step and cents.
      const line = M.noteLine(n, cycleHz, { tuning: state.tuning, snapped: snapActive() && n === lowN });
      const parts = line.rest.split(' · ');
      row.bandNote.textContent = parts[1] ?? '';
      row.bandHz.textContent = [`${M.fmtHz(rate)} Hz · ${n} × ${M.fmtHz(cycleHz)} Hz`, ...parts.slice(2)].join(' · ');
    }
    row.strip.setAttribute('aria-label', !n ? `${M.ROW_NAMES[r]}: off`
      : `${M.ROW_NAMES[r]}: ${n} beats, ` + (mode === 'band'
        ? `a tone at ${M.fmtHz(rate)} Hz, ${row.bandNote.textContent}`
        : `${rate.toFixed(2)} beats a second`) + (muted ? ', muted' : ''));
  });

  // Grid lines, rebuilt only when the grid changes
  const drawCols = L > 0 && L <= M.DRAW_MAX_COLUMNS ? L : 0;
  if (drawCols !== gridCols) {
    gridCols = drawCols;
    $('lines').hidden = !drawCols;
    $('lines').style.setProperty('--cols', Math.max(drawCols, 1));
    $('lines').innerHTML = '<span></span>'.repeat(drawCols);
  }

  // Speed
  $('speed').value = state.slider;
  const label = M.speedLabel(cycleHz);
  $('speed-label').textContent = label;
  $('speed').setAttribute('aria-valuetext', label);
  state.beats.forEach((n, r) => {
    fuseMarks[r].hidden = !n;
    if (n) fuseMarks[r].style.left = `${M.hzToPercent(M.fuseHz(n))}%`;
  });

  // The grid figure: the active rows as page columns, colorless, with the shared grid faint behind.
  $('page-rows').innerHTML = state.beats.map((n, r) => (n
    ? `<div class="pg-page__row${state.mute[r] ? ' is-muted' : ''}" style="--n:${n}">${'<span></span>'.repeat(n)}</div>` : '')).join('');
  const pageCols = L > 0 && L <= PAGE_MAX_COLUMNS ? L : 0;
  if (pageCols !== pageGridCols) {
    pageGridCols = pageCols;
    $('page-lines').hidden = !pageCols;
    $('page-lines').style.setProperty('--cols', Math.max(pageCols, 1));
    $('page-lines').innerHTML = '<span></span>'.repeat(pageCols);
  }
  $('page').setAttribute('aria-label', M.pageAria(state.beats));
  $('page-caption').textContent = M.pageCaption(state.beats);

  drawPlayheads(true);
}

function hexRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }

// ---------- Sound ----------

function applySound() {
  if (!sound) return;
  sound.setHz(hz());
  state.beats.forEach((n, r) => {
    sound.setBeats(r, n);
    sound.setRowGain(r, M.rowGain(state.db[r], state.mute[r]));
  });
  sound.setMaster(M.masterGain(state.master));
}

function changed() {
  render();
  applySound();
  save();
}

// ---------- Playheads: once per frame, read the audio clock ----------

let stageWidth = 0;
new ResizeObserver(([e]) => { stageWidth = e.contentRect.width; drawPlayheads(true); }).observe($('stage'));

function currentPhase() {
  if (!sound) return 0;
  return sound.phaseAt(heardTime(getAudioContext()));
}

function drawPlayheads(force = false) {
  const cycleHz = hz();
  const phase = currentPhase();
  const frac = ((phase % 1) + 1) % 1;

  rows.forEach((row, r) => {
    const n = state.beats[r];
    const show = n > 0 && n * cycleHz <= M.UNDERLINE_MAX_RATE;
    row.bar.hidden = !show;
    if (!show) return;
    const i = Math.floor(frac * n) % n;
    if (i !== row.lastIndex || force) {
      row.lastIndex = i;
      row.bar.style.transform = `translateX(${i * 100}%)`;
    }
  });

  const sweep = $('sweep');
  const showSweep = !!sound?.playing && !reducedMotion.matches && cycleHz <= M.SWEEP_MAX_HZ && M.gridColumns(state.beats) > 0;
  sweep.hidden = !showSweep;
  if (showSweep) $('sweep-line').style.transform = `translateX(${frac * stageWidth}px)`;
}

const frames = createFrameLoop({ getTime: () => 0, onFrame: () => drawPlayheads() });

bindPlayPause($('play'), {
  async onPlay() {
    await unlockAudio();
    if (!sound) { sound = createSound(getAudioContext()); applySound(); }
    sound.play();
    frames.start();
  },
  onPause() {
    sound?.pause();
    frames.stop();
    drawPlayheads(true);
  },
});

reducedMotion.addEventListener('change', () => drawPlayheads(true));

// ---------- Phones (spec, Layout: Phones) ----------
// The rail (Preset, Grid, Menu). The headline moves into the top bar; tuning, snap and master volume
// into the Menu; the grid callout into the Grid drawer; a row's Vol slider into its sheet. These are the
// desktop's own elements, moved, so their wiring stays as it is.

const phone = createPhoneFrame({
  app: 'polygrid',
  menuAria: 'Menu: tuning, snap and sound',
  tools: [
    { id: 'preset', icon: 'library_music', label: 'Preset', aria: 'Presets' },
    { id: 'grid', icon: 'view_week', label: 'Grid', aria: 'The grid' },
  ],
});
buildRotateScreen({ app: 'polygrid' });
const presetDrawer = phone.drawer('preset', { label: 'Presets' });
const gridDrawer = phone.drawer('grid', { label: 'The grid', wide: true });
gridDrawer.el.classList.add('pg-griddrawer');
const menuDrawer = phone.drawer('menu', { label: 'Menu', title: 'polygrid' });
const rowDrawer = phone.drawer('row', { label: 'Row settings' });
const rowTick = document.createElement('p');
rowTick.className = 'pg-sheet__tick';
const menuSettings = document.createElement('div');
menuSettings.className = 'pg-msettings';
menuDrawer.body.append(menuSettings, menuFooter('polygrid'));
rowDrawer.body.append(rowTick);

// Each moved element remembers where it came from, so the desktop gets it back in place.
const homes = new Map();
function moveTo(el, parent, before = null) {
  if (!homes.has(el)) homes.set(el, { parent: el.parentElement, next: el.nextSibling });
  parent.insertBefore(el, before);
}
function moveHome(el) {
  const home = homes.get(el);
  if (home) home.parent.insertBefore(el, home.next?.parentNode === home.parent ? home.next : null);
}
const topbarRow = document.querySelector('.pr-topbar__row');
const tuningLabel = $('tuning').closest('label');
const snapGroup = $('snap').closest('.pg-group');
const masterGroup = $('master').closest('.pg-group');
const callout = document.querySelector('.pg-callout');
const headline = document.querySelector('.pg-headline');

let sheetRow = null;
function openRowSheet(r) {
  closeRowSheet();
  sheetRow = r;
  rowDrawer.titleEl.textContent = M.ROW_NAMES[r];
  rowTick.textContent = TICK_NAMES[r];
  moveTo(rows[r].volRow, rowDrawer.body);
  phone.open('row');
}
function closeRowSheet() {
  if (sheetRow === null) return;
  moveHome(rows[sheetRow].volRow);
  sheetRow = null;
}

addEventListener('drawerchange', (e) => {
  if (e.detail !== 'row') closeRowSheet();
  if (e.detail === 'preset') { buildMenu(); menu.hidden = false; menu.querySelector('[aria-checked="true"]')?.focus(); }
});
menu.addEventListener('click', (e) => { if (isPhone() && e.target.closest('[role="menuitemradio"]')) phone.close(); });

function placeForPhone(on) {
  if (on) {
    moveTo(headline, topbarRow, $('play').nextSibling);
    moveTo(tuningLabel, menuSettings);
    moveTo(snapGroup, menuSettings);
    moveTo(masterGroup, menuSettings);
    moveTo(menu, presetDrawer.body);
    moveTo(callout, gridDrawer.body);
  } else {
    closeRowSheet();
    for (const el of [callout, menu, masterGroup, snapGroup, tuningLabel, headline]) moveHome(el); // last moved, first home
    menu.hidden = true;
  }
  render();
}
onPhoneChange(placeForPhone);
if (isPhone()) placeForPhone(true);

render();

bindShortcuts({ trigger: $('shortcuts-link'), groups: [
  ['Anywhere', [
    ['Space', 'Play or pause'],
    ['?', 'Show this list'],
  ]],
  ['Rows and slider', [
    ['↑ ↓', 'In a Beats field: change that row’s beat count'],
    ['← →', 'On the slider: move toward Rhythm or Tone'],
    ['Page Up / Down', 'On the slider: large steps'],
    ['Home / End', 'On the slider: jump to either end'],
  ]],
] });
