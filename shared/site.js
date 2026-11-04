// site.js: small behaviours shared by every page. Load as a module.

import { buildFooter } from './footer.js';

/** The bug-report Google Form. Empty until the form exists; links stay hidden until then. */
export const BUG_REPORT_URL = '';

/** The speaking and press Google Form. Empty until the form exists; the link stays hidden until then. */
export const SPEAKING_FORM_URL = '';

/** The Kit signup form's ID. Empty until the form exists; the signup section stays hidden until then. */
export const KIT_FORM_ID = '10133595'; // Kit form "Newsletter site"

/** Kit tag IDs for the optional "What would you pay for?" boxes. A box shows only once its tag ID is set. */
export const KIT_PAY_TAGS = { songs: '25328863', palettes: '25328864', wallpapers: '25328865', shirts: '25328866', workshops: '25328867', plugin: '25328868' };

/** Poly's shop on Fourthwall (custom domain, Nov 2). Shop links and callouts stay hidden while this is empty. */
export const SHOP_URL = 'https://shop.polyrhythmic.design/';

/** Where "Support the apps" goes: a Fourthwall custom page with a Donations section. Empty until that page exists; the link stays hidden until then. */
export const SUPPORT_URL = 'https://shop.polyrhythmic.design/pages/donate';

/** Show "Report a bug" links once the form URL is set. data-app prefills the App question later. */
export function wireBugLinks() {
  if (!BUG_REPORT_URL) return;
  for (const a of document.querySelectorAll('[data-bug-report]')) {
    a.href = BUG_REPORT_URL;
    a.hidden = false;
  }
}

/** Shop and Support links (footers, Menu, callouts). A callout shows once its shop link has a URL. */
export function wireShopLinks() {
  for (const [attr, url] of [['data-shop-link', SHOP_URL], ['data-support-link', SUPPORT_URL]]) {
    if (!url) continue;
    for (const a of document.querySelectorAll(`[${attr}]`)) {
      a.href = url;
      a.hidden = false;
    }
  }
  if (SHOP_URL) for (const c of document.querySelectorAll('[data-shop-callout]')) c.hidden = false;
}

export function wireSpeakingLink() {
  if (!SPEAKING_FORM_URL) return;
  for (const a of document.querySelectorAll('[data-speaking-link]')) {
    a.href = SPEAKING_FORM_URL;
    a.hidden = false;
  }
}

/** Poly hops when clicked (home page). Reduced motion keeps Poly still via CSS. */
/**
 * The email signup (home page). It posts to Kit; with JavaScript it stays on the page and reports in
 * a live status line, and if that request fails for any reason it falls back to a normal form post.
 */
export function wireSignup() {
  if (!KIT_FORM_ID) return;
  for (const section of document.querySelectorAll('[data-signup]')) {
    const form = section.querySelector('form');
    const status = section.querySelector('[role="status"]');
    form.action = `https://app.kit.com/forms/${KIT_FORM_ID}/subscriptions`;
    let anyTag = false;
    for (const box of form.querySelectorAll('[data-pay]')) {
      const id = KIT_PAY_TAGS[box.dataset.pay];
      box.closest('label').hidden = !id;
      if (id) { box.value = id; anyTag = true; }
    }
    form.querySelector('fieldset').hidden = !anyTag;
    section.hidden = false;
    form.addEventListener('submit', async (e) => {
      if (!form.checkValidity()) return; // let the browser show its own message
      e.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status.textContent = 'Signing you up…';
      try {
        const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        status.textContent = 'Thanks. Check your inbox to confirm.';
      } catch {
        status.textContent = '';
        form.submit(); // plain post to Kit, which shows its own confirmation page
      } finally {
        button.disabled = false;
      }
    });
  }
}

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
wireShopLinks();
wireSignup();
wirePolyHop();
