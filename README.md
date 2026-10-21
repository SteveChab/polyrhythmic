# polyrhythmic.design

Three free browser apps built on one idea: rhythm, pitch and color run on the same small whole-number ratios.

Play three beats against four slowly and you hear a groove. Speed it up and your ear stops counting and hears a chord. Raise that chord's frequencies 40 octaves and they land in visible light. Designers have used the same ratios for decades in their layout grids. These apps let you hear, see and play with that.

**Status:** version 1, launching October 2026.

## The apps

### polytoggle

A microtonal polyrhythmic drum and synth sequencer, and the flagship of the suite.

- Each lane loops on its own length (polymeter). A 3-beat lane and a 4-beat lane drift apart, then line up again every 12 beats.
- One switch, the polytoggle, flips to polyrhythm: every lane stretches to fill the same span of time.
- Up to 8 lanes of synthesized drums and synths, with no samples.
- Per-lane tuning: 12, 19, 24 or 31 equal divisions of the octave, or free Hz.
- Five scenes per song, each with its own notes and its own polymeter or polyrhythm setting.
- Every note is drawn in the color of its pitch.
- Songs save in the browser with no login, export as a `.polytoggle` file, and render to WAV.

### polycolor

A color wheel built from the frequency of sound, for designers and artists.

- Drop dots on the wheel to build a palette. Every color is also a note, so every palette is also a chord you can hear.
- Each swatch shows its hex, RGB and HSL values with copy buttons, plus its note, pitch and wavelength.
- Paste in an existing palette to hear what it sounds like.
- Export a PNG swatch card.

### polygrid

Hear design grids.

- Up to three rows, each split into up to 25 evenly spaced beats, with presets for common design grids and chords.
- One slider speeds the whole pattern from a rhythm into a tone. Rows of 3, 4 and 5 become a major chord.
- Shows the ratio, the grid it makes (3 and 4 columns meet at 12, add 5 and they meet at 60) and the notes it sounds.

## The color model

All three apps turn sound into color the same way.

| Color | Sound |
|---|---|
| Hue | Pitch |
| Saturation | Tone versus noise: full color is a pure tone, gray is noise |
| Lightness | Volume: 50% is the true color at full volume, and black and white are both silent |

Octave isn't a color. It shows on labels, for example "E2".

Pitch becomes hue by raising a note's frequency 40 octaves into visible light (A4 = 440 Hz lands near 620 nm, an orange-red), converting the wavelength to RGB, then to HSL. Notes that fall just past the edge of visible light get a hue blended between violet and red, so every note has a color.

## How it's built

- Plain HTML, CSS and JavaScript. No framework.
- The Web Audio API for all sound, scheduled ahead on the audio clock so timing stays tight.
- Shared modules for the color model and the tuning systems, used by all three apps.
- Accessibility first: everything works from the keyboard, focus states are obvious, nothing flashes more than three times a second, and motion respects `prefers-reduced-motion`.
- Type is IBM Plex Sans and IBM Plex Mono. Icons are Material Symbols.

This repo holds the app code.

## Roadmap

Planned work beyond the first version, including passing palettes and patterns between the apps and a VST plugin version of polytoggle, is tracked in [Issues](https://github.com/SteveChab/polyrhythmic/issues) under the `backlog` label.

## Contributing

Bug reports are welcome. Once the apps are live, every page will have a "Report a bug" link in its footer.

## License

The code in this repository is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). If you run a modified version as a web service, you must offer its source to your users under the same license.

Not covered by that license, and all rights reserved: Poly (the mascot), the polytoggle, polycolor, polygrid and polyrhythmic.design names and wordmarks, and the article text. IBM Plex is used under the SIL Open Font License (`shared/fonts/OFL.txt`).

Contributions are accepted under the same license.
