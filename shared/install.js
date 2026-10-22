// install.js: Add to Home Screen (site-spec, Phones). Opened from its Home Screen icon, an app runs
// with no browser bars at all, which is the only way to get there on an iPhone. Chrome on Android
// offers a real install prompt (beforeinstallprompt); iPhone Safari and some others (Brave) have none,
// so there we explain the two taps instead. Nothing here shows once the app is already running from the Home Screen.

let prompt = null;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep it for the Menu's button rather than the browser's own banner
  prompt = e;
  dispatchEvent(new Event('installchange'));
});
addEventListener('appinstalled', () => {
  prompt = null;
  dispatchEvent(new Event('installchange'));
});

export const isStandalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** True when the Menu should offer Add to Home Screen: always, until the app runs from the Home Screen. */
export const canInstall = () => !isStandalone();

/** Install where the browser offers a prompt; otherwise call `explain()` to show how (iPhone Safari, Brave and others). */
export async function install({ explain }) {
  if (!prompt) { explain(); return; }
  const p = prompt;
  prompt = null;
  p.prompt();
  await p.userChoice.catch(() => null);
  dispatchEvent(new Event('installchange'));
}

export const onInstallChange = (fn) => addEventListener('installchange', fn);
