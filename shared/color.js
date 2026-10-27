// color.js: the shared color model for polytoggle, polycolor and polygrid.
// Hue = pitch class, saturation = tone versus noise, brightness = volume.
// Pure math: no DOM, no audio. Spec: site-spec.md, "Shared color model".

export const A4 = 440;
export const SPEED_OF_LIGHT = 299_792_458; // m/s
export const LIFT_OCTAVES = 40;

// The fold window, G4 to F#5, in Hz. Every pitch folds into [G4, G5) before the lift.
export const G4 = A4 * 2 ** (-2 / 12); // 391.995 Hz
const WINDOW_LOW = G4;

// The edge blend: hues from F to G# are a straight line, not the true color.
// F is the last note kept at its true color (291.55°); F# is ultraviolet; G and G# are both red.
// The line starts at F's true hue, so the wheel has no step at F.
// Positions are in semitones above G (G = 0, G# = 1, ..., F = 10, F# = 11).
export const BLEND_START = 10; // F
export const BLEND_SPAN = 3; // F -> F# -> G -> G#
export const BLEND_END_HUE = 360; // G#, written 0

const mod = (n, m) => ((n % m) + m) % m;

/** Semitones above G within the octave, in [0, 12), for any frequency. */
export function positionAboveG(freq) {
  return mod(12 * Math.log2(freq / WINDOW_LOW), 12);
}

/** Fold a frequency into the G4 to F#5 window (octave doesn't change hue). */
export function foldToWindow(freq) {
  return WINDOW_LOW * 2 ** (positionAboveG(freq) / 12);
}

/** Wavelength in nm of a pitch raised 40 octaves, after folding into the window. */
export function wavelengthFromFrequency(freq) {
  const light = foldToWindow(freq) * 2 ** LIFT_OCTAVES;
  return (SPEED_OF_LIGHT / light) * 1e9;
}

/**
 * Dan Bruton's wavelength-to-RGB, channels 0..1, gamma 0.8.
 * The edge intensity falloff scales all three channels equally, so it never moves the hue;
 * it is left out because the model sets brightness from volume, not from the wavelength.
 */
export function brutonRGB(nm, gamma = 0.8) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = (440 - nm) / 60; b = 1; }
  else if (nm >= 440 && nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm >= 490 && nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm >= 580 && nm < 645) { r = 1; g = (645 - nm) / 65; }
  else if (nm >= 645 && nm <= 780) { r = 1; }
  else if (nm < 380) { r = 1; b = 1; } // past violet: not reached, the blend covers it
  return [r, g, b].map((c) => (c === 0 ? 0 : c ** gamma));
}

/** Hue in degrees [0, 360) of an RGB triple (0..1). */
export function hueOfRGB([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h;
  if (max === r) h = mod((g - b) / d, 6);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return mod(h * 60, 360);
}

function trueHueAt(position) {
  return hueOfRGB(brutonRGB(wavelengthFromFrequency(WINDOW_LOW * 2 ** (position / 12))));
}

/** F's true hue, where the blend starts: 291.55°. */
export const BLEND_START_HUE = trueHueAt(BLEND_START);

/** Hue in degrees [0, 360) for a position in semitones above G. */
export function hueFromPosition(position) {
  const p = mod(position, 12);
  const intoBlend = mod(p - BLEND_START, 12);
  if (intoBlend <= BLEND_SPAN) {
    return mod(BLEND_START_HUE + (intoBlend / BLEND_SPAN) * (BLEND_END_HUE - BLEND_START_HUE), 360);
  }
  return trueHueAt(p);
}

/** Hue in degrees [0, 360) for any frequency in Hz. Microtonal pitches work the same way. */
export function hueFromFrequency(freq) {
  return hueFromPosition(positionAboveG(freq));
}

/**
 * Color back to pitch: the frequency in the G4 to F#5 window whose hue is `hue`.
 * Inside the F-to-G# stretch the linear blend is inverted. Elsewhere the true hue rises
 * steadily from G# to F, so a binary search finds it. Pure reds (hue 0) return G#.
 */
export function frequencyFromHue(hue) {
  const h = mod(hue, 360);
  let position;
  if (h === 0 || h >= BLEND_START_HUE) {
    const t = h === 0 ? 1 : (h - BLEND_START_HUE) / (BLEND_END_HUE - BLEND_START_HUE);
    position = mod(BLEND_START + t * BLEND_SPAN, 12);
  } else {
    let lo = 1, hi = BLEND_START; // G# .. F
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (trueHueAt(mid) < h) lo = mid; else hi = mid;
    }
    position = (lo + hi) / 2;
  }
  return WINDOW_LOW * 2 ** (position / 12);
}

// ---------- Lightness = volume ----------

export const SILENCE_DB = -60;

/**
 * The model is HSL, as in Photoshop's Hue/Saturation/Lightness. Lightness 50% is the true color
 * and full volume; moving toward black (0%) or toward white (100%) lowers the volume, and both
 * ends are silent: a color with no hue can't be a note. 30 dB across half the scale, tuned by ear:
 * 25% and 75% lightness are both 9 dB down.
 */
export const LIGHTNESS_DB_SPAN = 30;

/** How close a lightness 0..100 is to the true color: 1 at 50%, 0 at black and at white. */
export const closeness = (l) => 1 - Math.abs(Math.min(100, Math.max(0, l)) - 50) / 50;

/** Lightness 0..100 to dB. 50 is 0 dB; black and white are silence (-Infinity). */
export function lightnessToDb(l) {
  const c = closeness(l);
  return c <= 0 ? -Infinity : LIGHTNESS_DB_SPAN * Math.log10(c);
}

/** Volume in dB to lightness on the dark side: 0 dB is 50%, and -60 dB or quieter is black. */
export function dbToLightness(db) {
  if (!(db > SILENCE_DB)) return 0;
  return 50 * 10 ** (Math.min(0, db) / LIGHTNESS_DB_SPAN);
}

/** dB to linear gain, with -Infinity as 0. */
export function dbToGain(db) {
  return db === -Infinity ? 0 : 10 ** (db / 20);
}

// ---------- Saturation = noise ----------

/** Mix for a saturation 0..100: how much pure tone and how much noise, each 0..1. */
export function noiseMix(saturation) {
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  return { tone: s, noise: 1 - s };
}

/**
 * Equal-power mix of tone and noise for a saturation 0..100: the two gains always add to the same
 * power, so the sweep from a pure tone to white noise stays even in loudness (a linear mix dips in
 * the middle). 100 is all tone, 0 is all noise. The noise comes in on a curve (NOISE_CURVE), tuned
 * by ear so a note is still clearly a note at 25% saturation.
 */
export const NOISE_CURVE = 3; // above 1 keeps the tone out in front longer, since noise masks a pitch easily
export function equalPowerMix(saturation) {
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  if (s === 0) return { tone: 0, noise: 1 };
  if (s === 1) return { tone: 1, noise: 0 };
  const a = ((1 - s) ** NOISE_CURVE * Math.PI) / 2;
  return { tone: Math.cos(a), noise: Math.sin(a) };
}

/** Scale for a white-noise buffer of uniform ±1 samples so it carries the power of a unit sine. */
export const WHITE_NOISE_TRIM = Math.sqrt(1.5);

/**
 * Makeup gain for noise that went through the pitch band-pass (Q from noiseBandQ at `centerHz`):
 * a narrow band carries far less power than white noise, so without this the noise is nearly
 * silent until the filter opens fully and then jumps. Capped at +32 dB. 1 when there is no filter.
 */
export function noiseBandMakeup(q, centerHz, sampleRate) {
  if (q === null) return 1;
  const enbw = (Math.PI / 2) * (centerHz / q); // equivalent noise bandwidth of a 2nd-order band-pass
  return Math.min(40, 1 / Math.sqrt(Math.min(1, enbw / (sampleRate / 2))));
}

/**
 * Q of the band-pass filter that carries a noisy note's pitch, for a saturation 0..100, or null
 * for no filter. Narrow when nearly pure, wider as saturation drops, fully open at 0%
 * (unfiltered white noise, no pitch).
 */
export function noiseBandQ(saturation) {
  if (saturation <= 0) return null;
  const s = Math.min(100, saturation) / 100;
  return 0.4 + 14 * s ** 2;
}

// ---------- HSB, RGB, hex ----------

/** HSB (h degrees, s and b 0..100) to RGB channels 0..255 (rounded). */
export function hsbToRgb(h, s, b) {
  const S = s / 100, V = b / 100;
  const C = V * S;
  const hp = mod(h, 360) / 60;
  const X = C * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [C, X, 0] : hp < 2 ? [X, C, 0] : hp < 3 ? [0, C, X] :
    hp < 4 ? [0, X, C] : hp < 5 ? [X, 0, C] : [C, 0, X];
  const m = V - C;
  return [r1, g1, b1].map((c) => Math.round((c + m) * 255));
}

/** RGB channels 0..255 to HSB (h degrees, s and b 0..100). */
export function rgbToHsb(r, g, b) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  return {
    h: hueOfRGB([r / 255, g / 255, b / 255]),
    s: max === 0 ? 0 : ((max - min) / max) * 100,
    b: max * 100,
  };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** HSL (h degrees, s and l 0..100) to RGB channels 0..255 (rounded). */
export function hslToRgb(h, s, l) {
  const S = s / 100, L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const hp = mod(h, 360) / 60;
  const X = C * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [C, X, 0] : hp < 2 ? [X, C, 0] : hp < 3 ? [0, C, X] :
    hp < 4 ? [0, X, C] : hp < 5 ? [X, 0, C] : [C, 0, X];
  const m = L - C / 2;
  return [r1, g1, b1].map((c) => Math.round((c + m) * 255));
}

/** RGB channels 0..255 to HSL (h degrees, s and l 0..100). */
export function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: hueOfRGB([R, G, B]), s: s * 100, l: l * 100 };
}

/** WCAG relative luminance of RGB 0..255. */
export function relativeLuminance(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Label color on a note: black when relative luminance is above 0.18, else white. */
export function labelInk(r, g, b) {
  return relativeLuminance(r, g, b) > 0.18 ? '#000000' : '#ffffff';
}

/**
 * The one call most screens need: the color of a sound.
 * @param {number} freq Hz
 * @param {{saturation?: number, db?: number}} [opts] saturation 0..100 (100 = pure tone, less is
 *   grayer and noisier), volume in dB (0 dB is the true color, quieter is darker)
 */
export function noteColor(freq, { saturation = 100, db = 0 } = {}) {
  const h = hueFromFrequency(freq);
  const s = saturation;
  const l = dbToLightness(db);
  const rgb = hslToRgb(h, s, l);
  return { h, s, l, rgb, hex: rgbToHex(...rgb), label: labelInk(...rgb), nm: wavelengthFromFrequency(freq) };
}
