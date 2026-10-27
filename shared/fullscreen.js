// fullscreen.js: full screen on a phone (site-spec, Phones). On Android the URL bar and the system
// buttons take a lot of a landscape screen; the Fullscreen API hides them. iPhone Safari has no
// Fullscreen API for pages, so there `canFullscreen` is false and nothing here shows or runs.
// Entering must happen inside a tap (a user gesture), so call enterFullscreen() straight from a handler.

const root = document.documentElement;

export const canFullscreen = () =>
  !!(root.requestFullscreen || root.webkitRequestFullscreen) && document.fullscreenEnabled !== false;

export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

/** Hide the browser's own bars. Resolves true if the page is now full screen. */
export async function enterFullscreen() {
  if (!canFullscreen()) return false;
  if (isFullscreen()) return true;
  try {
    await (root.requestFullscreen
      ? root.requestFullscreen({ navigationUI: 'hide' })
      : root.webkitRequestFullscreen());
  } catch {
    return false;
  }
  return isFullscreen();
}

export function exitFullscreen() {
  try { (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document); } catch { /* ignore */ }
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
