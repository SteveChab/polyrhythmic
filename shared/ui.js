// ui.js: shared controls. No audio here; apps pass callbacks.

/** Build an element: h('button', { class, text, html, onclick, 'aria-label': ... }, ...children). false, null and undefined are skipped. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
export const icon = (name) => h('span', { class: 'pr-icon', 'aria-hidden': 'true', text: name });

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

/** True when the element takes typed text (so Space must type a space): text-like inputs, textareas, selects, contenteditable. */
export function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has(String(el.type ?? '').toLowerCase());
}

/**
 * Make Space run `onSpace` from anywhere on the page, unless the user is editing text or an
 * open menu or dialog has focus. It wins over a focused button, switch or slider: keydown runs the
 * action once, and keyup is cancelled so a focused button doesn't also click.
 */
export function bindSpace(onSpace) {
  const ignore = (e) => e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey
    || isTextEntry(e.target) || !!e.target.closest?.('[role="menu"], dialog');
  document.addEventListener('keydown', (e) => {
    if (ignore(e)) return;
    e.preventDefault();
    if (!e.repeat) onSpace();
  });
  document.addEventListener('keyup', (e) => { if (!ignore(e)) e.preventDefault(); });
}

/**
 * Wire a Play/Pause toggle (.pr-btn--primary with a .pr-icon inside).
 * Playback toggles are play and pause, never stop: the icon swaps play_arrow / pause and the
 * accessible name swaps "Play" / "Pause" with it. Space toggles it from anywhere on the page,
 * even with a button focused, unless the user is typing (see bindSpace).
 * @returns {{ playing: boolean, set(playing: boolean): void }}
 */
export function bindPlayPause(button, { onPlay, onPause, labels = ['Play', 'Pause'], space = true }) {
  const icon = button.querySelector('.pr-icon');
  const text = button.querySelector('.pr-btn__label');
  let playing = false;

  function render() {
    if (icon) icon.textContent = playing ? 'pause' : 'play_arrow';
    const label = playing ? labels[1] : labels[0];
    if (text) text.textContent = label; else button.setAttribute('aria-label', label);
  }

  async function toggle() {
    playing = !playing;
    render();
    try { await (playing ? onPlay : onPause)?.(); }
    catch (err) { playing = !playing; render(); throw err; }
  }

  button.addEventListener('click', toggle);
  if (space) bindSpace(toggle);
  render();
  return {
    get playing() { return playing; },
    set(next) { if (next !== playing) { playing = next; render(); } },
  };
}

