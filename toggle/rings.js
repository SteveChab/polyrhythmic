// rings.js: the rings view, on phones held upright (spec, Phones: Upright, rings) and on desktop (spec, Rings view on
// desktop). Each lane is a ring, the first lane outside, in the grid's order; beat 1 sits at twelve o'clock and the beats
// run clockwise. The geometry is pure and tested; createRings() draws it as SVG at either size and moves the markers
// once per frame.

export const SIZE = 300;
export const OUTER = 148;
export const HOLE = 62; // the center, for the beat numerals
export const GAP = 4;
export const MAX_THICKNESS = 26;

/** The drawing's geometry. 300 is the phone's; 520 is the desktop's, with a small gap between beats. Other sizes scale the phone's. */
export function geometryFor(size = SIZE) {
  if (size === 520) return { size, outer: 254, hole: 88, max: 30, beatGap: 1.5, desktop: true };
  const k = size / SIZE;
  return { size, outer: OUTER * k, hole: HOLE * k, max: MAX_THICKNESS * k, beatGap: 0, desktop: false };
}

/** Lanes outside to inside: the grid's order, never sorted. */
export function ringOrder(lanes) {
  return [...lanes];
}

/** Outer and inner radius of each of `count` rings, outermost first, 4 px between rings. */
export function ringRadii(count, { outer = OUTER, hole = HOLE, gap = GAP, max = MAX_THICKNESS } = {}) {
  if (count <= 0) return [];
  const thick = Math.min(max, (outer - hole - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, k) => {
    const r1 = outer - k * (thick + gap);
    return { outer: r1, inner: r1 - thick };
  });
}

const pt = (r, deg, size) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [+(size / 2 + r * Math.cos(a)).toFixed(2), +(size / 2 + r * Math.sin(a)).toFixed(2)];
};

/** The SVG path of an annular sector between radii r0 < r1 and angles a0 < a1 (degrees clockwise from the top) in a square drawing of `size`. */
export function sectorPath(r0, r1, a0, a1, size = SIZE) {
  const large = a1 - a0 > 180 ? 1 : 0;
  if (a1 - a0 >= 360) a1 = a0 + 359.99;
  const [x1, y1] = pt(r1, a0, size), [x2, y2] = pt(r1, a1, size), [x3, y3] = pt(r0, a1, size), [x4, y4] = pt(r0, a0, size);
  return `M${x1} ${y1}A${r1} ${r1} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 ${large} 0 ${x4} ${y4}Z`;
}

/** Degrees clockwise from the top for a (fractional) step in a lane of n beats. */
export const angleOf = (position, n) => (position / n) * 360;

/** "OUTER RING · 8 BEATS" for the lane list. */
export function ringLabel(index, count, beats) {
  const place = count === 1 ? 'Only ring' : index === 0 ? 'Outer ring' : index === count - 1 ? 'Inner ring' : `Ring ${index + 1}`;
  return `${place} · ${beats} ${beats === 1 ? 'beat' : 'beats'}`;
}

/** A one-sentence name for the figure, for screen readers. */
export function ringsAria(ordered) {
  if (!ordered.length) return 'No lanes yet';
  const parts = ordered.map((l, i) => `${l.name} ${l.beats} ${l.beats === 1 ? 'beat' : 'beats'} ${i === 0 ? 'outside' : i === ordered.length - 1 ? 'inside' : 'next in'}`);
  return `${ordered.length === 1 ? 'One lane' : `${ordered.length} lanes`} as rings: ${parts.join(', ')}.`;
}

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/**
 * lanes given to render(): [{ id, name, beats, muted, notes: [{ beat, length, hex }] }] in song order.
 * render(lanes, poly, selectedLaneId, selectedNote): selectedNote is { laneId, beat } and gets the halo (desktop).
 * Returns { render, draw }.
 */
export function createRings(svg, { size = SIZE } = {}) {
  const geo = geometryFor(size);
  const C = size / 2;
  let rings = []; // { id, n, cells: [path], marker }
  let hand = null;
  let lastStep = new Map();
  let ordered = [];
  let longest = null; // the outer ring's lane, found once per render, not per frame
  let center = null;
  let poly = false;

  function render(lanes, polyrhythm, selectedId = null, selectedNote = null) {
    poly = polyrhythm;
    ordered = ringOrder(lanes);
    longest = ordered.reduce((best, l) => (!best || l.beats > best.beats ? l : best), null); // the center counts the longest lane
    svg.replaceChildren();
    rings = [];
    lastStep = new Map();
    const radii = ringRadii(ordered.length, { outer: geo.outer, hole: geo.hole, max: geo.max });
    const halos = [];
    ordered.forEach((lane, k) => {
      const { outer, inner } = radii[k];
      const g = el('g', { class: lane.muted ? 'is-muted' : '' });
      if (lane.id === selectedId) g.classList.add('is-selected');
      const cells = [];
      const step = 360 / lane.beats;
      const pad = geo.beatGap ? ((geo.beatGap / inner) * 180) / Math.PI : 0; // degrees trimmed from each side of a beat
      const note = selectedNote?.laneId === lane.id ? lane.notes.find((n) => n.beat === selectedNote.beat) : null;
      for (let b = 0; b < lane.beats; b++) {
        const hit = lane.notes.find((n) => b >= n.beat && b < n.beat + (n.length ?? 1));
        const d = sectorPath(inner, outer, b * step + pad, (b + 1) * step - pad, size);
        const path = el('path', { d, class: 'pt-ring__cell', 'data-info': hit ? 'ring-note' : 'ring-empty', 'data-lane': lane.id, 'data-beat': b, fill: hit ? (lane.muted ? (geo.desktop ? '#d8d8d8' : '#d9d9d9') : hit.hex) : '#fff' });
        cells.push(path);
        g.append(path);
        if (note && b >= note.beat && b < note.beat + (note.length ?? 1)) halos.push(d);
      }
      const marker = el('line', { class: 'pt-ring__marker', x1: C, y1: C - outer - 1, x2: C, y2: C - inner + 1 });
      marker.setAttribute('visibility', 'hidden');
      g.append(marker);
      svg.append(g);
      rings.push({ id: lane.id, n: lane.beats, cells, marker, inner, outer });
    });
    // The selected note: a 7 px white halo under a 3 px ink outline, over every beat it covers.
    for (const cls of ['pt-ring__halo-white', 'pt-ring__halo-ink']) for (const d of halos) svg.append(el('path', { d, class: cls }));
    hand = el('line', { class: 'pt-ring__hand', x1: C, y1: C - (radii[0]?.outer ?? geo.outer) - 2, x2: C, y2: C - geo.hole + 2 });
    hand.setAttribute('visibility', 'hidden');
    center = el('text', { class: 'pt-ring__center', x: C, y: C + (geo.desktop ? 10 : 4), 'text-anchor': 'middle' });
    const of = el('text', { class: 'pt-ring__of', x: C, y: C + (geo.desktop ? 36 : 28), 'text-anchor': 'middle' });
    svg.append(hand, center, of);
    svg._of = of;
    svg.setAttribute('aria-label', ringsAria(ordered));
    draw(null);
  }

  /** Once per frame. heads: the sequencer's playheads, or null before the first play. */
  function draw(heads, { reduced = false } = {}) {
    const head = longest && heads?.find((x) => x.laneId === longest.id);
    const reading = longest ? { beat: head ? head.step + 1 : 1, of: longest.beats } : null;
    if (center) {
      center.textContent = reading ? String(reading.beat) : '';
      svg._of.textContent = reading ? (geo.desktop ? `OF ${reading.of}` : `of ${reading.of}`) : '';
    }
    const live = !!heads;
    if (hand) hand.setAttribute('visibility', live && poly && ordered.length ? 'visible' : 'hidden');
    for (const r of rings) {
      const h = heads?.find((x) => x.laneId === r.id);
      r.marker.setAttribute('visibility', live && !poly && h ? 'visible' : 'hidden');
      if (!h) continue;
      const pos = reduced ? h.step : h.position;
      if (!poly) r.marker.setAttribute('transform', `rotate(${angleOf(pos, r.n)} ${C} ${C})`);
      if (lastStep.get(r.id) !== h.step) {
        const prev = lastStep.get(r.id);
        if (prev !== undefined) r.cells[prev]?.classList.remove('is-now');
        r.cells[h.step]?.classList.add('is-now');
        lastStep.set(r.id, h.step);
      }
    }
    if (hand && live && poly && head) hand.setAttribute('transform', `rotate(${angleOf(reduced ? head.step : head.position, longest.beats)} ${C} ${C})`);
  }

  return { render, draw };
}
