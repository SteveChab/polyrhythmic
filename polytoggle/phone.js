// polytoggle on a phone (spec, Phones): the rail (Add, Erase, Undo, Redo, Full, Menu), the Add drawer,
// the Menu drawer and the "How polytoggle works" dialog. The stage and the settings drawer are the
// desktop's own elements, laid out again by polytoggle.css under html.is-phone. app.js passes in
// what this needs; nothing here edits the song itself.

import { createPhoneFrame, menuGroup, menuItem, menuFooter, fullscreenControls } from '../shared/phone.js';
import { HELP } from './info.js';
import { h, icon } from '../shared/ui.js';


/**
 * api: {
 *   instruments: [{ id, name, group, color }], maxLanes, laneCount(), songName(), sceneNumber(),
 *   addLane(id), preview(id), erase(), eraseLabel(), eraseOn(), undo(), redo(), canUndo(), canRedo(),
 *   renameSong(), newSong(), openEntries(close), save(), exportSong(), exportWav(),
 *   duplicateScene(), clearScene(), canDuplicateScene(),
 *   zoom: { min, max, get(), set(v) }, master: { get(), set(pos), text() },
 *   install: { available(), run() },
 * }
 */
export function setupPhone(api) {
  const fullscreen = fullscreenControls();
  const frame = createPhoneFrame({
    app: 'polytoggle',
    menuAria: 'Menu: song, files, scenes and view',
    tools: [
      { id: 'add', icon: 'add_box', label: 'Add', aria: 'Add a lane' },
      { id: 'erase', icon: 'ink_eraser', label: 'Erase', onClick: () => api.erase() },
      { id: 'undo', icon: 'undo', label: 'Undo', onClick: () => api.undo() },
      { id: 'redo', icon: 'redo', label: 'Redo', onClick: () => api.redo() },
      fullscreen.tool,
    ].filter(Boolean),
  });

  // ---- Add a lane ----
  const count = h('span', { class: 'pt-drawer__count' });
  const add = frame.drawer('add', { label: 'Add a lane', title: h('span', {}, 'Add a lane', count) });
  for (const [group, label] of [['drum', 'Drum'], ['synth', 'Synth']]) {
    const list = h('section', { class: 'pt-addgroup', 'aria-label': label }, h('h3', { class: 'pr-mgroup', text: label }));
    for (const inst of api.instruments.filter((i) => i.group === group)) {
      list.append(h('div', { class: 'pt-addrow' },
        h('button', { class: 'pt-addrow__hear', type: 'button', 'aria-label': `Hear ${inst.name}`, onclick: () => api.preview(inst.id) },
          h('span', { class: 'pr-swatch', style: `--swatch:${inst.color}`, 'aria-hidden': 'true' }),
          h('span', { class: 'pt-addrow__name', text: inst.name }),
          icon('volume_up')),
        h('button', { class: 'pt-addrow__add', type: 'button', 'aria-label': `Add ${inst.name} as a lane`, onclick: () => { frame.close(); api.addLane(inst.id); } }, icon('add'))));
    }
    add.body.append(list);
  }

  // ---- Menu ----
  const menu = frame.drawer('menu', { label: 'Menu', wide: true, title: '' });
  const nameBtn = h('button', { class: 'pt-menuname', type: 'button', onclick: () => { frame.close(); api.renameSong(); } }, h('span', { class: 'pt-menuname__text' }), icon('edit'));
  menu.titleEl.append(nameBtn);

  const run = (fn) => () => { frame.close(); fn(); };
  const openSub = h('div', { class: 'pt-opensub', hidden: true });
  const openBtn = menuItem({ icon: 'folder_open', label: 'Open', hint: 'Recent · demo · import', chevron: true, attrs: { 'aria-expanded': 'false', 'aria-controls': 'phone-open-list' } });
  openSub.id = 'phone-open-list';
  openBtn.addEventListener('click', () => {
    const show = openSub.hidden;
    openSub.hidden = !show;
    openBtn.setAttribute('aria-expanded', String(show));
    if (show) openSub.replaceChildren(...api.openEntries(() => frame.close()));
  });
  const wavItem = menuItem({ icon: 'graphic_eq', label: 'Export audio', hint: '.wav', onClick: run(api.exportWav) });
  const sceneHead = menuGroup('');
  const dupScene = menuItem({ icon: 'library_add', label: 'Duplicate scene', onClick: run(api.duplicateScene) });

  const zoomRange = h('input', { class: 'pr-range', type: 'range', min: String(api.zoom.min), max: String(api.zoom.max), step: '1', 'aria-label': 'Zoom: how wide the beats draw' });
  zoomRange.addEventListener('input', () => api.zoom.set(Number(zoomRange.value)));
  const masterRange = h('input', { class: 'pr-range', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Master volume' });
  const masterOut = h('span', { class: 'pt-mrow__out', 'aria-hidden': 'true' });
  masterRange.addEventListener('input', () => api.master.set(Number(masterRange.value)));
  masterRange.addEventListener('change', () => api.master.done());

  const installItem = menuItem({ icon: 'add_to_home_screen', label: 'Add to Home Screen', hint: 'full screen', onClick: () => { frame.close(); api.install.run(); } });

  const helpDialog = buildHelp();
  menu.body.append(
    menuGroup('Song'),
    menuItem({ icon: 'note_add', label: 'New song', onClick: run(api.newSong) }),
    openBtn, openSub,
    menuItem({ icon: 'save', label: 'Save to this browser', onClick: run(api.save) }),
    menuItem({ icon: 'download', label: 'Export song file', hint: '.polytoggle', onClick: run(api.exportSong) }),
    wavItem,
    sceneHead,
    dupScene,
    menuItem({ icon: 'layers_clear', label: 'Clear scene', onClick: run(api.clearScene) }),
    menuGroup('View and sound'),
    h('div', { class: 'pt-mrow' }, h('span', { class: 'pt-mrow__label', text: 'Zoom', 'aria-hidden': 'true' }),
      h('button', { class: 'pt-mrow__step', type: 'button', 'aria-label': 'Zoom out', text: '−', onclick: () => { api.zoom.set(api.zoom.get() - 8); render(); } }),
      zoomRange,
      h('button', { class: 'pt-mrow__step', type: 'button', 'aria-label': 'Zoom in', text: '+', onclick: () => { api.zoom.set(api.zoom.get() + 8); render(); } })),
    h('div', { class: 'pt-mrow pt-mrow--master' }, h('span', { class: 'pt-mrow__label', text: 'Master volume', 'aria-hidden': 'true' }), masterRange, masterOut),
    ...[fullscreen.row, installItem].filter(Boolean),
    menuItem({ icon: 'help', label: 'How polytoggle works', onClick: () => { frame.close(); helpDialog.showModal(); helpDialog.querySelector('button').focus(); }, attrs: { class: 'pr-mi pt-mi--help' } }),
    menuFooter('polytoggle'),
  );

  function buildHelp() {
    const close = h('button', { class: 'pt-help__close', type: 'button', 'aria-label': 'Close' }, icon('close'));
    const dlg = h('dialog', { class: 'pt-help', 'aria-labelledby': 'help-title' },
      h('div', { class: 'pt-help__head' }, h('h2', { id: 'help-title', text: 'How polytoggle works' }), close),
      h('dl', { class: 'pt-help__list' }, HELP.map(([t, d]) => h('div', { class: 'pt-help__item' }, h('dt', { text: t }), h('dd', { text: d })))));
    close.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // a tap on the backdrop
    dlg.addEventListener('close', () => frame.button('menu').focus());
    document.body.append(dlg);
    return dlg;
  }

  /** Bring the rail and drawers up to date; app.js calls this whenever it renders the top bar. */
  function render() {
    count.textContent = `${api.laneCount()} of ${api.maxLanes}`;
    for (const b of add.body.querySelectorAll('.pt-addrow__add')) b.disabled = api.laneCount() >= api.maxLanes;
    frame.button('undo').disabled = !api.canUndo();
    frame.button('redo').disabled = !api.canRedo();
    const erase = frame.button('erase');
    erase.setAttribute('aria-pressed', String(api.eraseOn()));
    erase.setAttribute('aria-label', api.eraseLabel());
    nameBtn.querySelector('.pt-menuname__text').textContent = api.songName();
    nameBtn.setAttribute('aria-label', `Rename song: ${api.songName()}`);
    const n = api.sceneNumber();
    wavItem.querySelector('.pr-mi__hint').textContent = `.wav · scene ${n}`;
    sceneHead.textContent = `Scene ${n}`;
    dupScene.disabled = !api.canDuplicateScene();
    if (document.activeElement !== zoomRange) zoomRange.value = String(api.zoom.get());
    if (document.activeElement !== masterRange) masterRange.value = String(api.master.get());
    masterOut.textContent = api.master.text();
    installItem.hidden = !api.install.available();
    masterRange.setAttribute('aria-valuetext', api.master.text());
  }

  return { render, frame };
}
