// The article: figures drawn from the shared color model, the polymeter/polyrhythm switch, and Poly's walk.
import { noteColor, hueFromFrequency } from '../shared/color.js';

const G4 = 391.995;
const NOTES = ['G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#'];
const NM = ['696 nm', '657 nm', '620 nm', '585 nm', '552 nm', '521 nm', '492 nm', '464 nm', '438 nm', '414 nm', '390 nm', 'UV · blend'];
const hz = (i) => G4 * 2 ** (i / 12);
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

// Bands labeled with a note: color and label ink from the model.
for (const el of document.querySelectorAll('.band[data-hz]')) {
  const c = noteColor(Number(el.dataset.hz));
  el.style.background = c.hex;
  el.style.color = c.label;
}

// 04: the twelve notes as light.
document.getElementById('spectrum').innerHTML = NOTES.map((n, i) => {
  const c = noteColor(hz(i));
  return `<div class="sp"><div style="background:${c.hex};color:${c.label}">${n.replace('#', '♯')}</div><span>${NM[i]}</span></div>`;
}).join('');

// 05: hue, saturation, lightness, octave.
const hues = NOTES.map((_, i) => hueFromFrequency(hz(i)));
const e = hueFromFrequency(hz(9));
const dbToL = (db) => (db <= -60 ? 0 : 50 * 10 ** (db / 30));
const model = [
  ['Hue', 'Pitch', 12, hues.map((h) => hsl(h, 100, 50)), 'The pitch class. G through F♯, one octave of light.'],
  ['Saturation', 'Noise', 6, [100, 80, 60, 40, 20, 0].map((s) => hsl(e, s, 50)), 'Full color is a pure tone. Turn it down and it goes gray, and gray is noise.'],
  ['Lightness', 'Volume', 6, [0, -6, -12, -24, -45, -60].map((db) => hsl(e, 100, dbToL(db))), '50% is the true color at full volume. Toward black or white it gets quieter, and both are silence.'],
  ['Octave', 'the label', 6, Array(6).fill(hsl(e, 100, 50)), 'Not a color. A number on the note: E1, E2, E3.'],
];
document.getElementById('model').innerHTML = model.map(([c, s, n, sw, note]) =>
  `<div><dt>${c} <span>=</span> ${s}</dt><dd><div class="sw" style="grid-template-columns:repeat(${n},minmax(0,1fr))" aria-hidden="true">${sw.map((b) => `<i style="background:${b}"></i>`).join('')}</div><span>${note}</span></dd></div>`).join('');

// 06: the light wheel and the pitch wheel, C E G marked on both.
const chord = [5, 9, 0];
const polar = (deg, r) => { const a = (deg * Math.PI) / 180; return [(50 + r * Math.sin(a)).toFixed(2), (50 - r * Math.cos(a)).toFixed(2)]; };
function wheel(even) {
  const bg = even
    ? `conic-gradient(from -15deg, ${NOTES.map((_, i) => `${hsl(hues[i], 100, 50)} ${i * 30 + 15}deg`).join(', ')}, ${hsl(hues[0], 100, 50)} 375deg)`
    : 'conic-gradient(hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))';
  const ang = (i) => (even ? i * 30 : hues[i]);
  const labels = NOTES.map((n, i) => { const [x, y] = polar(ang(i), 46); return `<span class="wheel__lab" style="left:${x}%;top:${y}%;font-weight:${chord.includes(i) ? 700 : 400}">${n.replace('#', '♯')}</span>`; }).join('');
  const dots = chord.map((i) => { const [x, y] = polar(ang(i), 28.5); return `<span class="wheel__dot" style="left:${x}%;top:${y}%;background:${hsl(hues[i], 100, 50)}"></span>`; }).join('');
  const title = even ? 'Pitch wheel · evenly spaced' : 'Light wheel · true hues';
  const text = even
    ? 'Every semitone gets the same slice, so the angle is pitch and the colors stretch to fit. C, E and G form the same triangle every major chord makes.'
    : 'The wheel a screen knows: angle is hue, red through green to blue. Each note sits where its light lands, so the notes crowd into the reds and spread out through green and blue. This is polycolor.';
  const aria = even ? 'Pitch wheel with the 12 notes evenly spaced. C, E and G marked.' : 'Light wheel with the 12 notes at their true hues, unevenly spaced. C, E and G marked.';
  return `<div class="wheel"><div class="wheel__disc" role="img" aria-label="${aria}"><div class="wheel__ring" style="background:${bg}"></div><div class="wheel__hole"></div>${labels}${dots}</div><span class="art-label">${title}</span><p>${text}</p></div>`;
}
document.getElementById('wheels').innerHTML = wheel(false) + wheel(true);

// 07: the working switch.
const lanes = document.getElementById('lanes');
const tog = document.getElementById('tog');
const gC = noteColor(391.995).hex;
const cC = noteColor(523.251).hex;
function drawLanes(rhythm) {
  const lane = (n, bg) => { const len = rhythm ? n : 12; return `<div class="lane" style="grid-template-columns:repeat(${len},minmax(0,1fr))">${Array.from({ length: len }, (_, i) => `<i style="background:${bg}">${(i % n) + 1}</i>`).join('')}</div>`; };
  lanes.innerHTML = lane(3, gC) + lane(4, cC);
  lanes.setAttribute('aria-label', rhythm ? 'Polyrhythm: a lane of 3 and a lane of 4 stretched across the same bar' : 'Polymeter: a lane of 3 and a lane of 4 on the same pulse, meeting again after 12 steps');
  document.getElementById('tog-note').textContent = rhythm ? 'One bar, stretched: 3 and 4 land in the same span' : 'Same pulse: the lanes meet again every 12 steps';
  document.getElementById('lbl-meter').classList.toggle('off', rhythm);
  document.getElementById('lbl-rhythm').classList.toggle('off', !rhythm);
}
tog.addEventListener('click', () => {
  const on = tog.getAttribute('aria-checked') !== 'true';
  tog.setAttribute('aria-checked', String(on));
  drawLanes(on);
});
drawLanes(false);

// Poly: starts top-left beside the title, walks down the left column as you scroll, then stays near the bottom of the window.
const SPRITE = ['.KKKKKKKKKKKKKKK.', '.KCCCCCCCCCCCCCK.', '.KCWWWWWWWWWWWCK.', '.KCW1WWW2WWW3WCK.', '.KCWWWWWWWWWWWCK.', '.KCW4WW5W6WW7WCK.', '.KCWWWWWWWWWWWCK.', '.KCW8W9WaWbWcWCK.', '.KCWWWWWWWWWWWCK.', '.KCWWKKWWWKKWWCK.', 'KKCWWKKWWWKKWWCKK', '.KCWWWWKWKWWWWCK.', '.KCWWWWWKWWWWWCK.', '.KCCCCCCCCCCCCCK.', '.KKKKKKKKKKKKKKK.', '....KK.....KK....', '....KKK....KKK...'];
const COL = { K: '#111111', C: '#9a9a9a', W: '#ffffff', 1: '#e60058', 6: '#e60058', a: '#e60058', 2: '#36e600', 4: '#36e600', 7: '#36e600', 8: '#36e600', c: '#36e600', 3: '#7700e6', 5: '#7700e6', 9: '#7700e6', b: '#7700e6' };
const walker = document.getElementById('walker');
const art = document.querySelector('.art');
function sprite(rows) {
  walker.innerHTML = rows.flatMap((r, y) => [...r].map((ch, x) => (COL[ch] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${COL[ch]}"/>` : ''))).join('');
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let frame = -1;
function place() {
  const narrow = matchMedia('(max-width: 900px)').matches;
  const sy = reduced.matches ? 0 : window.scrollY;
  const at = art.getBoundingClientRect().top + window.scrollY;
  const size = narrow ? 34 : 68;
  const startY = narrow ? 24 : 56;
  const restY = sy - at + window.innerHeight - (narrow ? 80 : 140);
  const prog = Math.min(1, sy / Math.max(1, window.innerHeight * 0.6));
  const y = Math.round(startY + (restY - startY) * prog);
  const x = narrow ? 0 : Math.round(((1 - Math.cos((sy / 700) * Math.PI)) / 2) * 120);
  walker.style.setProperty('--y', `${y}px`);
  walker.style.setProperty('--x', `${x}px`);
  walker.setAttribute('width', size); walker.setAttribute('height', size);
  const step = Math.floor(sy / 48) % 2 === 1;
  const arms = Math.floor(sy / 900) % 3 === 2;
  const key = `${step}${arms}`;
  if (key !== frame) {
    frame = key;
    const rows = SPRITE.slice();
    if (step) { rows[15] = '.....KK....KK....'; rows[16] = '.....KKK....KKK..'; }
    if (arms) { rows[8] = `K${rows[8].slice(1, 16)}K`; rows[9] = `K${rows[9].slice(1, 16)}K`; rows[10] = `.${rows[10].slice(1, 16)}.`; }
    sprite(rows);
  }
}
let queued = false;
const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; place(); }); };
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
place();
