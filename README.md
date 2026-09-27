# ASCII Image Art Studio

A client-side image-to-text studio for creating shaded ASCII, Braille, half-block, and shade-block artwork. Images are decoded and rendered in your browser; no image data is uploaded or persisted.

## Features

- Grayscale ASCII with editable density palettes and custom characters
- Braille with Floyd–Steinberg, Stucki, Atkinson, Burkes, Sierra Lite, Bayer 2×2/4×4/8×8, and threshold dithering
- Half-block and shade-block renderers
- Brightness, contrast, exposure, gamma, black/white points, saturation, blur, sharpening, aspect, width, mirroring, inversion, and whitespace controls
- Drag/drop, file-picker, and clipboard-paste image loading
- Original, artwork, and comparison previews
- Copy and TXT, HTML, SVG, and PNG exports
- Presets, settings history, local preferences, and keyboard shortcuts
- Web Worker rendering with a main-thread fallback and a bounded output size

Supported input depends on the browser's image decoder; PNG, JPEG, WebP, GIF, and BMP are supported by current browsers. Images up to 40 MB and 80 megapixels are accepted. Output is limited to 220 columns and 40,000 character cells.

## Run locally

Install the development dependencies, build the TypeScript modules, and serve the app:

```sh
npm install
npm run serve
```

Open <http://localhost:8080>. For iterative TypeScript development, run `npm run watch` in another terminal. `npm run dev` serves the currently built files without rebuilding.

## Build and test

```sh
npm run build
npm test
```

`npm test` builds first, then runs the Node.js built-in test runner against pure rendering algorithms and checks that app selectors exist in the HTML. No runtime framework or test dependency is needed. The project targets Node.js 18+ for development scripts.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open image | Ctrl/Cmd + O |
| Copy artwork | Ctrl/Cmd + C |
| Undo / redo | Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z |
| Download TXT | Ctrl/Cmd + S |
| Reset settings | R |
| Show shortcuts | ? |

Shortcuts are ignored while typing in a form field. The help button in the header also lists them.

## Architecture

- `src/app.ts` owns interface events, preferences, history, image loading, worker lifecycle, clipboard, and exports.
- `src/settings.ts` defines shared types, defaults, validation, and bounded output dimension calculation.
- `src/image-pipeline.ts` resizes and mirrors a decoded image, composites transparency onto white, and applies tone adjustments in a fresh `ImageData` buffer.
- `src/renderer-registry.ts` dispatches render modes and Braille dithering; renderer algorithms remain in `src/braille-render.ts`, `src/grayscale-render.ts`, `src/kernel-ditherer.ts`, and `src/ordered-ditherer.ts`.
- `src/render-worker.ts` runs pixel-to-character conversion away from the UI thread. If workers are blocked, rendering falls back to the main thread.
- `dist/` is generated from `src/` by `npm run build` and is the browser-served output.

The uploaded image remains in memory only. Settings and custom presets are stored in `localStorage`; source image bytes are never saved there. Contributions should include focused tests for changes to pure rendering behavior.
