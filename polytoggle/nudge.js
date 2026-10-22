// nudge.js: steppers for polytoggle's value cells on a phone. A number box makes a poor touch
// control: scrubbing it is twitchy and focusing it opens the keyboard over the stage. On a phone
// the cells take focus without a keyboard (inputmode="none"), and this bar changes whichever cell
// has focus: coarse and fine steps either side, hold to repeat, and a keyboard button for the
// times typing is wanted. app.js owns the song; this file only moves values and calls back.

const MINUS = '\u2212';

/** Per cell: `fine` and `coarse` step sizes. `pitch` cells step by tuning step (fine) or octave (coarse). */
export const NUDGE = {
  'n-pitch': { pitch: true }, 'n-hz': { pitch: true },
  'n-octave': { fine: 1, coarse: null },
  'n-length': { fine: 1, coarse: 4 },
  'n-noise': { fine: 1, coarse: 10 },
  'n-volume': { fine: 1, coarse: 6 },
  'env-attackMs': { fine: 10, coarse: 100 },
  'env-decayMs': { fine: 10, coarse: 100 },
  'env-sustainPct': { fine: 1, coarse: 10 },
  'env-releaseMs': { fine: 10, coarse: 100 },
  'p-lane-vol': { fine: 1, coarse: 6 },
  'p-lane-pan': { fine: 5, coarse: 25 },
  bpm: { fine: 1, coarse: 10 },
};

const HOLD_MS = 420;
const REPEAT_MS = 80;

/**
 * session: { begin(), end() }: a press (or a whole hold) is one undo step, like a scrub.
 * pitch: { step(dir), octave(dir) }: app.js moves the selected note.
 * float: true for the BPM bar, which appears under the top bar only while BPM has focus.
 */
export function createNudge({ session, pitch, float = false, label = 'Change the selected value' }) {
  let target = null;
  let busy = false; // true while a pitch step lets go of focus, so the bar keeps its target

  const el = document.createElement('div');
  el.className = `pt-nudge${float ? ' pt-nudge--float' : ''}`;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', label);
  if (float) el.hidden = true;

  const status = document.createElement('span');
  status.className = 'pr-sr';
  status.setAttribute('role', 'status');

  const kbd = document.createElement('button');
  kbd.type = 'button';
  kbd.className = 'pt-nudge__btn pt-nudge__kbd';
  kbd.setAttribute('aria-label', 'Type a value with the keyboard');
  kbd.innerHTML = '<span class="pr-icon" aria-hidden="true">keyboard</span>';

  const mk = (dir, coarse) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pt-nudge__btn${coarse ? ' pt-nudge__btn--coarse' : ''}`;
    b.dataset.dir = String(dir);
    b.dataset.coarse = coarse ? '1' : '';
    return b;
  };
  const buttons = [mk(-1, true), mk(-1, false), mk(1, false), mk(1, true)];
  el.append(kbd, ...buttons, status);

  const spec = () => (target ? NUDGE[target.id] : null);

  function paint() {
    const s = spec();
    kbd.disabled = !s;
    for (const b of buttons) {
      const dir = Number(b.dataset.dir);
      const coarse = !!b.dataset.coarse;
      const sign = dir < 0 ? MINUS : '+';
      let text = '';
      let aria = '';
      let off = !s;
      if (s?.pitch) {
        text = coarse ? `${sign}oct` : `${sign}step`;
        aria = `${dir < 0 ? 'Down' : 'Up'} one ${coarse ? 'octave' : 'step'}`;
      } else if (s) {
        const unit = coarse ? s.coarse : s.fine;
        off = !unit;
        text = unit ? `${sign}${unit}` : '';
        aria = unit ? `${dir < 0 ? 'Decrease' : 'Increase'} by ${unit}` : '';
      } else {
        text = dir < 0 ? MINUS : '+';
      }
      b.textContent = text;
      b.disabled = off;
      if (aria) b.setAttribute('aria-label', aria); else b.removeAttribute('aria-label');
    }
  }

  function setTarget(input) {
    target = input && NUDGE[input.id] ? input : null;
    if (float) el.hidden = !target;
    paint();
  }

  function say() {
    if (!target) return;
    const cell = target.closest('.pt-param');
    const name = cell?.querySelector('.pt-param__label')?.textContent ?? target.getAttribute('aria-label') ?? '';
    const unit = cell?.querySelector('.pt-param__unit')?.textContent ?? '';
    status.textContent = `${name} ${target.value}${unit ? ` ${unit}` : ''}`.trim();
  }

  // The pitch cells are only repainted while they are not focused, so let go of focus while the note moves.
  function refocus(input, fn) {
    busy = true;
    try {
      input.blur();
      fn();
      input.focus({ preventScroll: true });
    } finally {
      busy = false;
    }
  }

  function once(b) {
    const s = spec();
    if (!s || !target) return;
    const dir = Number(b.dataset.dir);
    const coarse = !!b.dataset.coarse;
    if (s.pitch) {
      refocus(target, () => (coarse ? pitch.octave(dir) : pitch.step(dir)));
    } else {
      const unit = coarse ? s.coarse : s.fine;
      if (!unit) return;
      const lo = target.min === '' ? -Infinity : Number(target.min);
      const hi = target.max === '' ? Infinity : Number(target.max);
      const v = Math.max(lo, Math.min(hi, Math.round((Number(target.value || 0) + dir * unit) * 10) / 10));
      target.value = String(v);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    say();
  }

  for (const b of buttons) {
    // A press steps once, then repeats while held. The whole hold is one undo step.
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || b.disabled || !target) return;
      session.begin();
      once(b);
      let timer = setTimeout(function tick() { once(b); timer = setTimeout(tick, REPEAT_MS); }, HOLD_MS);
      const stop = () => {
        clearTimeout(timer);
        removeEventListener('pointerup', stop);
        removeEventListener('pointercancel', stop);
        session.end();
      };
      addEventListener('pointerup', stop);
      addEventListener('pointercancel', stop);
    });
    // Keyboard and screen readers click without a pointer (detail 0); a pointer press was handled above.
    b.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      session.begin();
      once(b);
      session.end();
    });
  }
  // Keep focus on the cell while a button is pressed, so the bar keeps its target.
  el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // The keyboard button: bring the keyboard up for this one cell, then back to none when it loses focus.
  kbd.addEventListener('click', () => {
    const t = target;
    if (!t) return;
    t.inputMode = t.type === 'text' || (t.min !== '' && Number(t.min) < 0) ? 'text' : 'decimal';
    t.blur();
    t.focus();
    t.select?.();
    t.addEventListener('blur', () => { t.inputMode = 'none'; }, { once: true });
  });

  /** Follow focus inside `scope`: a value cell takes the bar, anything else lets it go. */
  function watch(scope, { also = [] } = {}) {
    const inside = (n) => !!n && (scope.contains(n) || el.contains(n) || also.some((x) => x.contains(n)));
    scope.addEventListener('focusin', (e) => { if (!busy && !el.contains(e.target)) setTarget(e.target.matches?.('input') ? e.target : null); });
    scope.addEventListener('focusout', (e) => { if (!busy && !inside(e.relatedTarget)) setTarget(null); });
    el.addEventListener('focusout', (e) => { if (!busy && !inside(e.relatedTarget)) setTarget(null); });
  }

  paint();
  return { el, setTarget, watch, get target() { return target; } };
}
