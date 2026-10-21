// ui.js: shared controls. No audio here; apps pass callbacks.

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

/** Wire a .pr-switch (role="switch"). Returns a setter. */
export function bindSwitch(button, onChange) {
  const get = () => button.getAttribute('aria-checked') === 'true';
  button.addEventListener('click', () => {
    button.setAttribute('aria-checked', String(!get()));
    onChange?.(get());
  });
  return { get checked() { return get(); }, set(v) { button.setAttribute('aria-checked', String(!!v)); } };
}
