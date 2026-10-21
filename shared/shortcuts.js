// The Keyboard shortcuts dialog, the same in every app: a button at the bottom left of the page
// opens it, and so does "?". Each app passes its groups of [keys, what it does].

/**
 * @param {object} o
 * @param {HTMLElement} o.trigger the "Keyboard shortcuts" button
 * @param {Array<[string, Array<[string, string]>]>} o.groups
 * @returns {{ dialog: HTMLDialogElement, open: () => void }}
 */
export function bindShortcuts({ trigger, groups }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'pr-dialog pr-keys';
  dialog.setAttribute('aria-labelledby', 'keys-title');
  dialog.innerHTML = '<div class="pr-keys__head"><h2 id="keys-title">Keyboard shortcuts</h2><button class="pr-btn" type="button">Close</button></div><div class="pr-keys__body"></div>';
  const body = dialog.querySelector('.pr-keys__body');
  const close = dialog.querySelector('button');
  for (const [group, rows] of groups) {
    const section = document.createElement('section');
    const h3 = document.createElement('h3');
    h3.className = 'pr-keys__group';
    h3.textContent = group;
    const dl = document.createElement('dl');
    dl.className = 'pr-keys__list';
    for (const [keys, what] of rows) {
      const dt = document.createElement('dt'); dt.textContent = keys;
      const dd = document.createElement('dd'); dd.textContent = what;
      dl.append(dt, dd);
    }
    section.append(h3, dl);
    body.append(section);
  }
  document.body.append(dialog);

  const open = () => { if (!dialog.open) { dialog.showModal(); close.focus(); } };
  trigger.addEventListener('click', open);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => trigger.focus());
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input:not([type="range"]):not([type="checkbox"]), textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    open();
  });
  return { dialog, open };
}
