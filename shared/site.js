// site.js: small behaviours shared by every page. Load as a module.

import { buildFooter } from './footer.js';

/** The bug-report Google Form. Empty until the form exists; links stay hidden until then. */
export const BUG_REPORT_URL = '';

/** The speaking and press Google Form. Empty until the form exists; the link stays hidden until then. */
export const SPEAKING_FORM_URL = '';

/** Show "Report a bug" links once the form URL is set. data-app prefills the App question later. */
export function wireBugLinks() {
  if (!BUG_REPORT_URL) return;
  for (const a of document.querySelectorAll('[data-bug-report]')) {
    a.href = BUG_REPORT_URL;
    a.hidden = false;
  }
}

export function wireSpeakingLink() {
  if (!SPEAKING_FORM_URL) return;
  for (const a of document.querySelectorAll('[data-speaking-link]')) {
    a.href = SPEAKING_FORM_URL;
    a.hidden = false;
  }
}

/** Poly hops when clicked (home page). Reduced motion keeps Poly still via CSS. */
function wirePolyHop() {
  for (const btn of document.querySelectorAll('.poly-button')) {
    btn.addEventListener('click', () => {
      btn.classList.remove('is-hopping');
      void btn.offsetWidth; // restart the animation
      btn.classList.add('is-hopping');
    });
    btn.addEventListener('animationend', () => btn.classList.remove('is-hopping'));
  }
}

/**
 * Home and the article on a narrow screen: the four site links fold into a menu button at the right of
 * the header (site-spec, Phones). The button is built here so desktop pages carry no extra markup.
 */
function wireSiteMenu() {
  const header = document.querySelector('.site-header');
  const nav = header?.querySelector('.site-nav');
  if (!nav) return;
  nav.id ||= 'site-nav';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'site-menu-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', nav.id);
  btn.innerHTML = '<span class="pr-icon" aria-hidden="true">menu</span><span class="pr-sr">Menu</span>';
  header.insertBefore(btn, nav);
  const set = (open) => {
    header.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('.pr-icon').textContent = open ? 'close' : 'menu';
  };
  btn.addEventListener('click', () => set(!header.classList.contains('is-open')));
  header.addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.classList.contains('is-open')) { set(false); btn.focus(); } });
  document.addEventListener('pointerdown', (e) => { if (!header.contains(e.target)) set(false); });
}

buildFooter();
wireSiteMenu();
wireBugLinks();
wireSpeakingLink();
wirePolyHop();
