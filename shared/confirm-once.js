// A confirmation that undo can reverse is asked once. Whatever the answer, it never comes back,
// and it says so. The same pattern in every app that has undo: polytoggle, polycolor.

export const ONCE_NOTE = 'This is the only time you’ll be asked. From now on it happens straight away, and ⌘Z undoes it.';

/**
 * @param {object} o
 * @param {string} o.prefix the app's localStorage prefix, e.g. 'polycolor'
 * @param {(opts: {title: string, text: string, ok: string}) => Promise<boolean>} o.ask shows the dialog
 * @param {Storage} [o.storage]
 * @returns {(name: string, opts: {title: string, text: string, ok: string}) => Promise<boolean>}
 */
export function createConfirmOnce({ prefix, ask, storage = globalThis.localStorage }) {
  return async (name, opts) => {
    const key = `${prefix}:seen-confirm:${name}`;
    let seen = false;
    try { seen = JSON.parse(storage.getItem(key)) === true; } catch { /* ask */ }
    if (seen) return true;
    const yes = await ask({ ...opts, text: `${opts.text} ${ONCE_NOTE}` });
    try { storage.setItem(key, 'true'); } catch { /* private mode: it may ask again */ }
    return !!yes;
  };
}
