# Settings screen mockups

Static HTML mockups of the Settings screen from roadmap decision 10. Baker
approves these before task 9 builds the screen in the app. Nothing in this
folder is app code.

## Files

| File | What it is |
|------|------------|
| `settings.html` | The Settings screen |
| `today.html` | The existing Today screen with the new Settings tab, to show the entry point |
| `tokens.css` | Colors, spacing and type, each traced to `app/src/theme.ts`, an app component, or the archive web app |
| `settings.css` | Components, each rule naming the app style it copies |
| `mock.js` | Mockup behaviour (toggles, pickers, connection test) and frame params. Plain browser JS so the files open from disk |
| `capture.mts` | Headless capture of the six review images (TypeScript, run by Node directly) |
| `fonts/` | Roboto, the face Android draws the app in (SIL OFL 1.1) |

## Viewing

Open `settings.html` in a browser. URL params pick the variant:

- `scheme=dark` for the dark scheme
- `eink=1` for the Boox e-ink theme
- `chrome=phone` or `chrome=eink` to draw a status bar and system insets
- `sheet=voice` (or `writer`, `tz`, `time`, `host1`, `licenses`) to open a picker

Everything you can tap does something: toggles, the text size circles, the
pickers, Test connection, Show, and Check now. The header line shows the
save, then the sync, after every change.

## Capturing

```sh
CHROME_BIN=/path/to/chrome node design/settings/capture.mts [outDir]
```

It needs Node 22.18 or newer and no npm packages. It writes `phone-*.png`,
`eink-*.png` and `desktop-*.png` in light and dark, plus `index.json` with
the metrics for every frame. Each PNG is a row (or column) of real viewport
frames: phone 390x844, e-ink 702x936 (the Boox Note Air panel, 1404x1872 at
2x) and desktop 1280x800, scrolled from the top of the page to the bottom.
The script exits 1 if a frame has the wrong viewport, scrolls sideways,
misses the font, loads the wrong page, or if an e-ink image has a single
pixel that is not gray. The output folder defaults to `shots/`, which git
ignores.

## Design decisions

**Entry point.** Settings is a third tab in the existing text-only tab bar.
The tab bar is the app's only persistent navigation, and a tab works on the
Boox with no gestures. Android back from Settings goes to Today, the same
as Archive.

**Header.** It copies the Archive title block. The line under it shows that
a change is saved on the device first and then synced to the server, which
is how decision 10 says settings work.

**Section heads.** They use the story row's category label: an 8px dot and
11px bold caps. The label is in the text color with the accent on the dot,
because the accent on white is only 3.0:1.

**Scope tags.** Each section says whether it applies to this device or is
synced. Notifications, Reading and Server are per device. Daily podcast
lives on the server, since the scheduler reads it from `/settings`.

**On and off.** Switches are the atoms from DESIGN.md: a thin ring when off,
a solid disc with a check when on. The shape changes along with the color,
so the state reads on e-ink and for color-blind readers. The same control
marks the chosen option in every picker.

**Episode time.** It is set large in the edition card's date style, because
the time is the podcast setting people will change most.

**Text size.** Four rings with an "A" at growing sizes. A story row under
them redraws at the chosen size.

**Server fields.** No boxes. The row hairline is the underline, and it turns
into a 2px accent line on focus. Test connection reuses the update banner's
2px progress bar and its dot plus caps status label.

**Actions.** They are text only, like the update banner's Download and
Install. On e-ink there is no accent color to set them apart, so there they
take the 1px outline of the error screen's Retry button.

**Desktop.** The same 720px column as the archive web app, with the tab bar
under it. The left gutter holds a section index that follows the scroll.

**E-ink.** The `eink` palette from `theme.ts`: black on white, nothing
lighter than #444 for text, 1px black rules, no motion. Dark e-ink inverts
it, with muted text at #BBBBBB so it keeps the same contrast.

## Things task 9 needs to know

The app has no dark scheme today (`app.json` pins `userInterfaceStyle` to
light). The dark mockups use the cover-side tokens `theme.ts` already has
(`coverBg`, `textDark`, `mutedDark`, `dividerDark`) plus the archive app's
`#0D0D0D` nav and black page. Building dark Settings means adding a scheme
switch to the theme. There is no Appearance setting because decision 10
does not list one.

The accent `#2B9FD9` is 3.0:1 on white, so accent text (actions, the active
tab) is under the 4.5:1 that small text needs. The rest of the app has the
same gap. Fixing it is a token change for the whole app, so these mockups
keep the current accent.

The host voice names are ElevenLabs premade voices. The real list should
come from the selected provider. The time picker is a list here; the app can
use the platform time picker instead.
