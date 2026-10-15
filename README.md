# Brother PT Label Editor

A browser-only editor for data-driven label strips on the Brother PT-P300BT.
Each CSV record becomes a label, an HTML template places escaped column values,
and CSS controls the physical layout. The exact monochrome raster shown in the
preview is sent to the printer.

[Open the application](https://burgrp.github.io/label-editor/)

## Features

- Live CodeMirror editors for CSV data and a combined HTML/CSS panel with tabs.
- Standard quoted CSV records with cursor-driven selected-row preview.
- Escaped zero-based placeholders such as `{{0}}` and `{{1}}`.
- Per-record CSS classes and bundled Font Awesome Free icons.
- Selected-label and continuous whole-strip preview with optional label wrapping
  and grab-to-pan scrolling.
- Physical 3.5, 6, 9, and 12 mm tape sizing at 180 DPI.
- Safe, self-contained templates: no scripts or remote resources.
- CSV-file loading, browser auto-save, and template/settings JSON import/export.
- Direct PT-P300BT printing through Web Serial over Bluetooth Classic SPP.
- Static deployment with no backend or cloud account.

## Browser and printer requirements

Printing requires:

1. A Brother PT-P300BT paired in the operating system's Bluetooth settings.
2. Chrome or Edge with Web Serial support.
3. A secure context: HTTPS or `localhost`.
4. Explicit serial-device permission when **Connect printer** is pressed.

The editor and preview continue to work when Web Serial is unavailable. Web
Bluetooth is not used: the PT-P300BT exposes Bluetooth Classic SPP/RFCOMM, not a
BLE GATT service. The printer has a manual cutter, so a whole strip is sent as
one continuous job and cut once by hand.

## Preview navigation

The editors share the upper workspace, and a full-width preview occupies roughly
30% of the screen height below them. Editors and preview scroll independently;
the application itself stays within the viewport.

Use the three-position switch in the preview header:

- **Selected row** shows the CSV record at the cursor.
- **Strip** shows every label on one continuous tape.
- **Wrapped** arranges all labels into rows as space allows.

Wrapping only changes the preview layout; the printer still receives a
continuous strip in CSV order. The selected preview mode is saved with the
document.

Zoom defaults to **3x**. At **1x**, the tape is displayed in physical CSS
millimetres instead of mapping one 180-DPI printer dot to one screen pixel.
The apparent real-world size still depends on browser zoom and display scaling.

Click and drag anywhere on the tape to pan an overflowing preview horizontally
or vertically. Scrollbars and normal touch scrolling remain available.

## Template model

The CSV has no header row. Every non-empty record is one label:

```csv
Ada Lovelace,Analytical Engine,1843
"Grace Hopper","Compiler pioneer",1952
```

HTML references zero-based fields:

```html
<strong>{{0}}</strong>
<span>{{1}}</span>
```

Values are HTML-escaped before insertion. If a row does not have a referenced
column, the placeholder becomes blank and the application displays a warning.
Malformed CSV blocks preview and printing until corrected.

The application supplies the outer `.label` element. Tape width controls its
printable height and reserves the PT-P300BT's unprintable tape-edge margins;
CSS controls label width, padding, and internal layout:

```css
.label {
  width: 48mm;
  padding: 1mm 2mm;
  display: flex;
  align-items: center;
}
```

Templates may use ordinary presentational HTML plus inline `data:` images.
Scripts, event handlers, forms, frames, CSS imports, and remote images or fonts
are blocked. Imported documents are validated before replacing the current
document.

### Per-record classes

A CSV cell starting with the exact, case-sensitive prefix `class:` adds CSS
classes to that record's outer `.label` element:

```csv
Normal label,Some detail,
Important label,Check wiring,class:warning
Compact label,Small text,class:warning compact
```

```css
.label.warning {
  border: 0.5mm solid black;
  font-weight: bold;
}

.label.compact {
  width: 30mm;
  font-size: 8pt;
}
```

Class cells can appear in any column. Names are whitespace-separated; classes
from multiple cells are combined and duplicates are removed. Empty `class:`
cells add nothing, and the base `label` class is always retained.

Column indexes and values do not change: a placeholder referencing a class cell
still renders its original escaped value. Leave that column out of the template
when it is only used for styling. Classes apply equally to selected-row, strip,
wrapped preview, and printed labels.

### Font Awesome icons

Font Awesome Free 7 is bundled locally, including Solid, Regular, and Brands.
Use the normal icon classes directly in the HTML template:

```html
<i class="fa-solid fa-house" aria-hidden="true"></i> {{0}}
<i class="fa-regular fa-envelope" aria-hidden="true"></i>
<i class="fa-brands fa-github" aria-hidden="true"></i>
```

Set icon size with CSS (for example `.fa-solid { font-size: 16pt; }`) or Font
Awesome size classes such as `fa-2x`. A field can also supply icon classes with
`<i class="{{0}}" aria-hidden="true"></i>`. Icon fonts are embedded in the
isolated renderer and raster capture, so no CDN, remote font, or script is
needed. Icons print as the same monochrome pixels shown in preview.

Only Free icons are included; Pro styles and icons are not bundled. Font
Awesome is by Fonticons, Inc.; its fonts are licensed under SIL OFL 1.1 and CSS
under MIT. The production build includes `fontawesome-license.txt` with the
upstream notices and licenses.

## Loading data and sharing templates

Use **Load CSV** in the Data panel to replace the label data from a UTF-8 CSV
file. HTML, CSS, and settings remain unchanged. Malformed CSV is loaded into the
editor with diagnostics; preview and printing stay blocked until it is fixed.
Loading a file selects its first record.

The header's **Template & settings** Import and Export buttons handle HTML, CSS,
tape width, black threshold, and preview mode. Export downloads
`label-template.json` without CSV data. Import preserves the current data and
selection, and invalid template files leave the current document unchanged.
Older full-document JSON exports can still be imported; their data is ignored.

Browser auto-save continues to preserve the entire current document, including
its CSV data.

## Development

Node.js 22 is recommended.

```bash
npm install
npm run dev
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run lint` | Run Oxlint |
| `npm run typecheck` | Type-check the project |
| `npm test` | Run Vitest unit and component tests |
| `npm run test:e2e` | Run Playwright browser tests |
| `npm run build` | Type-check and create the static `dist/` build |
| `npm run check` | Run lint, type-check, unit tests, and build |

Playwright downloads Chromium in CI. Local runs use the installed Chrome
channel by default.

## Deployment

The Vite build uses relative assets, so `dist/` can be served from any static
path. The included GitHub Pages workflow deploys pushes to `main`. GitHub Pages
must be configured to use **GitHub Actions** as its source.

## Hardware validation

Protocol and transport behavior are covered with deterministic fake-transport
tests. Before relying on a release with physical labels, run the
[PT-P300BT hardware smoke test](docs/hardware-smoke-test.md).

## Current scope

The initial implementation intentionally targets the PT-P300BT, comma-separated
data, numeric placeholders, local documents, and one continuous strip. The
printer interface is separated from rendering so additional Brother PT models
can be added without changing the editor document format.
