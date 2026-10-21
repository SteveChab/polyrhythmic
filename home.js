// Home page: colors from the shared color model, and the explainer video placeholder.
// The explainer video section is hidden in index.html until the video exists (unhide it and set VIDEO_ID).

import { noteColor } from './shared/color.js';

/** The YouTube video id of Poly's explainer. Empty until it's recorded: the player stays a placeholder. */
const VIDEO_ID = '';

const color = (hz, db = 30 * Math.log10(0.9)) => noteColor(hz, { db }).hex;
const cells = (n, bg) => '<span class="ratio-cell"></span>'.repeat(n).replace(/class="ratio-cell"/g, `class="ratio-cell" style="background:${bg}"`);

// The 3 : 4 : 5 rows: G, C and E, a major chord.
for (const row of document.querySelectorAll('[data-note-hz]')) {
  row.innerHTML = cells(Number(getComputedStyle(row).getPropertyValue('--count')), color(Number(row.dataset.noteHz)));
}

// Video poster: the same three rows.
for (const el of document.querySelectorAll('[data-rows]')) {
  el.innerHTML = [[3, 392], [4, 523.25], [5, 659.26]].map(([n, hz]) => `<span class="ratio-row" style="--count:${n}">${cells(n, color(hz))}</span>`).join('');
}

// polytoggle card: three lanes of different lengths, with a few notes.
const toggle = document.querySelector('[data-toggle-visual]');
if (toggle) {
  const lanes = [[4, [0, 2], 65.41], [3, [1], 220], [5, [0, 3], 329.63]];
  toggle.innerHTML = lanes.map(([n, hits, hz]) => `<span class="mini-row" style="--count:${n}">${Array.from({ length: n }, (_, i) => `<i${hits.includes(i) ? ` style="background:${color(hz)}"` : ''}></i>`).join('')}</span>`).join('');
}

// polycolor card: dots in the colors of their notes.
for (const dot of document.querySelectorAll('[data-dot-hz]')) dot.style.setProperty('--swatch', color(Number(dot.dataset.dotHz)));

// polygrid card: three rows that go from separate clicks to a solid band of color.
const grid = document.querySelector('[data-grid-visual]');
if (grid) {
  grid.innerHTML = [[3, 392], [4, 523.25], [5, 659.26]].map(([n, hz]) => {
    const c = color(hz);
    return `<span class="band-row"><span class="band-row__clicks" style="--count:${n}">${'<i></i>'.repeat(n)}</span><span class="band-row__tone" style="background:${c}"></span></span>`;
  }).join('');
}

// The ladder: A is orange-red.
const swatch = document.querySelector('[data-ladder-swatch]');
if (swatch) swatch.style.background = noteColor(440).hex;

// The explainer: only embed YouTube (no-cookie) once someone presses play.
const note = document.getElementById('video-note');
const play = document.getElementById('video-play');
if (!VIDEO_ID) {
  play.disabled = true;
  play.setAttribute('aria-label', 'Explainer video, coming soon');
  note.textContent = 'The explainer video is coming soon.';
} else {
  note.textContent = 'Captions are on. The video loads from YouTube only when you press play.';
  play.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&cc_load_policy=1&rel=0`;
    frame.title = 'Poly explains polyrhythmic.design';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    document.getElementById('video').replaceChildren(frame);
    frame.focus();
  });
}
