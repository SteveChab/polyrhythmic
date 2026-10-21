// The shared footer. Pages hold an empty <footer data-footer="app|site" data-root="../">; this fills it.
// App pages keep their Keyboard shortcuts button in the footer's HTML and get the links beside it.
// The Report a bug and Speaking and press links stay hidden until site.js sets their form URLs.

const YEAR = 2026;
const REPO = 'https://github.com/SteveChab/polyrhythmic';
const OUT = '<span class="pr-icon pr-icon--ext" aria-hidden="true">open_in_new</span><span class="pr-sr">(opens in a new tab)</span>';

const link = (href, text, attrs = '') => `<a href="${href}"${attrs}>${text}</a>`;
const external = (href, text, attrs = '') => `<a href="${href}" target="_blank" rel="noopener"${attrs}>${text}${OUT}</a>`;
const bug = (app) => external('', 'Report a bug', ` data-bug-report${app ? ` data-app="${app}"` : ''} hidden`);
const speaking = () => external('', 'Speaking and press', ' data-speaking-link hidden');
const byline = `made by ${link('https://stevechab.com', 'Steve Chab')}`;
const copyright = `<span>© ${YEAR} Steve Chab</span>`;
const license = external(`${REPO}/blob/main/LICENSE`, 'Code: AGPL-3.0');

/** The footer links as they sit at the foot of an app's Menu on a phone (site-spec, Phones). */
export function menuLinksHTML(root, app) {
  return [
    link(root, 'polyrhythmic.design', ' class="foot-mark"'),
    bug(app),
    speaking(),
    `<span class="foot-base">${byline} · ${license} · © ${YEAR}</span>`,
  ].join('');
}

export function buildFooter() {
  const footer = document.querySelector('footer[data-footer]');
  if (!footer) return;
  const root = footer.dataset.root || '';
  if (footer.dataset.footer === 'app') {
    const app = document.body.dataset.app || '';
    const nav = document.createElement('nav');
    nav.className = 'foot-links';
    nav.setAttribute('aria-label', 'About this site');
    nav.innerHTML = [
      link(root, 'polyrhythmic.design', ' class="foot-mark"'),
      byline,
      bug(app),
      speaking(),
      license,
      copyright,
    ].join('');
    footer.append(nav);
    return;
  }
  footer.innerHTML = `
    <div class="foot-cols">
      <nav aria-label="The apps and the article"><p class="foot-head">polyrhythmic.design</p><ul>
        <li>${link(`${root}polytoggle/`, 'polytoggle')}</li><li>${link(`${root}polycolor/`, 'polycolor')}</li>
        <li>${link(`${root}polygrid/`, 'polygrid')}</li><li>${link(`${root}about/`, 'about')}</li></ul></nav>
      <nav aria-label="Contact and source"><p class="foot-head">Contact</p><ul>
        <li>${bug('')}</li><li>${speaking()}</li><li>${external(REPO, 'GitHub')}</li><li>${license}</li></ul></nav>
      <p class="foot-privacy">No login, no cookies, no ads.</p>
    </div>
    <p class="foot-base">${byline} · ${copyright} · Poly and the wordmarks are not licensed for reuse.</p>`;
}
