// phone.js: the phone frame shared by the three apps (site-spec, Phones): a left rail with Poly,
// the app's tools and Menu; drawers that slide over the stage from the rail; the Menu's footer
// links. Landscape gets a left rail; upright (Oct 27) the same buttons become a bottom bar. phone-mode.js (in <head>) decides when the
// phone layout applies by setting html.is-phone. Everything here is built once and hidden by CSS
// on larger screens, so switching layouts never rebuilds the app.

import { menuLinksHTML } from './footer.js';
import { wireBugLinks, wireSpeakingLink } from './site.js';
import { isStandalone } from './install.js';
import { canFullscreen, isFullscreen, enterFullscreen, exitFullscreen, onFullscreenChange } from './fullscreen.js';
import { h, icon } from './ui.js';

export const isPhone = () => document.documentElement.classList.contains('is-phone');

/** Run `fn(isPhone)` whenever the layout switches between phone and desktop. */
export function onPhoneChange(fn) {
  addEventListener('phonechange', () => fn(isPhone()));
}


/** A copy of the page's Poly (the pixel SVG in the app's logo), for the header's Poly in the upright layout. */
function polyCopy() {
  const poly = document.querySelector('.pr-logo .poly');
  return poly ? poly.cloneNode(true) : h('span');
}

/**
 * Build the rail and its drawers.
 * tools: [{ id, icon, label, aria?, onClick? }]: a tool with no onClick opens the drawer of the same id.
 * Returns { rail, button(id), drawer(id, opts), open(id), close(), openId }.
 */
export function createPhoneFrame({ app, root = '../', tools, menuAria }) {
  const buttons = new Map();
  const drawers = new Map();
  let openId = null;

  const railButton = ({ id, icon: name, label, aria, onClick }) => {
    const b = h('button', { class: 'pr-railbtn', type: 'button', id: `rail-${id}`, 'aria-label': aria ?? null }, icon(name), h('span', { class: 'pr-railbtn__label', text: label }));
    b.addEventListener('click', () => (onClick ? onClick(b) : toggle(id)));
    buttons.set(id, b);
    return b;
  };

  const home = h('a', { class: 'pr-railhome', href: root, 'aria-label': `${app}, go to polyrhythmic.design home` }, polyCopy());
  const rail = h('nav', { class: 'pr-phone-rail', 'aria-label': 'Tools' },
    home,
    tools.map(railButton),
    h('span', { class: 'pr-phone-rail__spacer' }),
    railButton({ id: 'menu', icon: 'menu', label: 'Menu', aria: menuAria ?? 'Menu' }));
  document.body.prepend(rail);

  function drawer(id, { label, title, wide = false } = {}) {
    const titleEl = h('h2', { class: 'pr-drawer__title' });
    if (title instanceof Node) titleEl.append(title); else titleEl.textContent = title ?? label;
    const close = h('button', { class: 'pr-drawer__close', type: 'button', 'aria-label': `Close ${label.toLowerCase()}` }, icon('close'));
    close.addEventListener('click', () => closeAll(true));
    const body = h('div', { class: 'pr-drawer__body' });
    const el = h('aside', { class: `pr-drawer${wide ? ' pr-drawer--wide' : ''}`, id: `drawer-${id}`, 'aria-label': label, hidden: true },
      h('div', { class: 'pr-drawer__head' }, titleEl, close), body);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAll(true); } });
    document.body.append(el);
    drawers.set(id, el);
    const b = buttons.get(id);
    if (b) { b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', el.id); }
    return { el, body, titleEl };
  }

  function open(id) {
    if (openId === id) return;
    closeAll(false);
    const el = drawers.get(id);
    if (!el) return;
    openId = id;
    el.hidden = false;
    buttons.get(id)?.setAttribute('aria-expanded', 'true');
    dispatchEvent(new CustomEvent('drawerchange', { detail: id }));
    (el.querySelector('.pr-drawer__body :is(button, a, input, select):not(:disabled):not([hidden])') ?? el.querySelector('.pr-drawer__close'))?.focus({ preventScroll: true });
  }

  function closeAll(refocus) {
    if (openId === null) return;
    const id = openId;
    openId = null;
    drawers.get(id).hidden = true;
    const b = buttons.get(id);
    b?.setAttribute('aria-expanded', 'false');
    dispatchEvent(new CustomEvent('drawerchange', { detail: null }));
    if (refocus) b?.focus();
  }

  function toggle(id) { if (openId === id) closeAll(true); else open(id); }

  // A tap outside the open drawer (and outside the rail) closes it, like any menu.
  document.addEventListener('pointerdown', (e) => {
    if (openId === null) return;
    const el = drawers.get(openId);
    if (el.contains(e.target) || rail.contains(e.target) || e.target.closest?.('dialog')) return;
    closeAll(false);
  }, true);
  onPhoneChange((phone) => { if (!phone) closeAll(false); });

  return {
    rail, drawer, open, close: () => closeAll(true), toggle,
    button: (id) => buttons.get(id),
    get openId() { return openId; },
  };
}

/** A Menu group heading. The first group in a drawer has no rule above it (CSS). */
export const menuGroup = (title) => h('h3', { class: 'pr-mgroup', text: title });

/** A 48px Menu row: icon, label, then a short mono hint right after the label. */
export function menuItem({ icon: name, label, hint, onClick, id, chevron = false, attrs = {} }) {
  const b = h('button', { class: 'pr-mi', type: 'button', id, ...attrs }, icon(name), h('span', { class: 'pr-mi__label', text: label }),
    hint ? h('span', { class: 'pr-mi__hint', text: hint }) : null,
    chevron ? h('span', { class: 'pr-icon pr-mi__chev', 'aria-hidden': 'true', text: 'chevron_right' }) : null);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** The footer links at the foot of the Menu: there's no separate footer in the apps on a phone. */
export function menuFooter(app, root = '../') {
  const el = h('nav', { class: 'pr-mfoot', 'aria-label': 'About this site', html: menuLinksHTML(root, app) });
  queueMicrotask(() => { wireBugLinks(); wireSpeakingLink(); });
  return el;
}

/**
 * Full screen, twice (site-spec, Phones): a rail / bottom-bar tool and a Menu row. Only on a user's tap, never
 * automatically; both hide where there's no Fullscreen API (iPhone Safari) or the app already runs from the Home Screen.
 * Returns { tool, row }: pass `tool` in createPhoneFrame's tools and put `row` in the Menu (both null when unsupported).
 */
export function fullscreenControls() {
  if (!canFullscreen() || isStandalone()) return { tool: null, row: null };
  const toggle = () => (isFullscreen() ? exitFullscreen() : enterFullscreen()); // straight from the tap: entering needs its user gesture
  const row = menuItem({ icon: 'fullscreen', label: 'Full screen', hint: 'off', attrs: { 'aria-pressed': 'false' }, onClick: toggle });
  const sync = () => {
    const on = isFullscreen();
    const btn = document.getElementById('rail-full');
    for (const el of [btn, row]) {
      el.setAttribute('aria-pressed', String(on));
      el.querySelector('.pr-icon').textContent = on ? 'fullscreen_exit' : 'fullscreen';
    }
    btn.querySelector('.pr-railbtn__label').textContent = on ? 'Exit' : 'Full';
    row.querySelector('.pr-mi__hint').textContent = on ? 'on' : 'off';
  };
  onFullscreenChange(sync);
  return { tool: { id: 'full', icon: 'fullscreen', label: 'Full', aria: 'Full screen', onClick: toggle }, row };
}
