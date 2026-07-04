# 🎞️ gifify

[![CI](https://github.com/bharvey88/gifify/actions/workflows/ci.yml/badge.svg)](https://github.com/bharvey88/gifify/actions/workflows/ci.yml)

![gifify demo](.github/assets/gifify-demo.webp)

*The demo above practices what it preaches: the screen recorder produced a
53 MB GIF; gifify's WebP pipeline turned it into the 5 MB animation you're
watching.*

A local web app that turns screen recordings into **animated WebP**, **GIF**, or
**tiny MP4** clips — built for documentation wikis, READMEs, and anywhere you
need a short demo that loads fast.

Drop a video in, trim it on a visual scrubber, hit a preset, and compare file
sizes until it's right. Your videos never leave your machine: the app runs on
`localhost` and uses your own ffmpeg install.

## Features

- **Drag-and-drop queue** — drop one or many videos; each keeps its own settings
- **Visual trimming** — drag start/end handles on a timeline, or set them from
  the playhead; loop-preview just the trimmed range
- **Crop** — draw a box right on the video frame; drag inside it to reposition
- **Speed** — 1x to 3x, which shortens the clip and shrinks the file
- **Live results** — see the animated output and its file size right in the
  page, tweak quality/width/fps, convert again, and compare attempts
- **Auto-fit to a size** — type "10 MB" and gifify searches for the best
  quality that fits (Discord caps, wiki budgets); every attempt stays in history
- **Copy for pasting** — one click copies a ready-made Markdown or HTML snippet
- **Presets** — Wiki WebP (24 fps, 720 px), Wiki GIF (15 fps, palette-optimized),
  Tiny MP4 (x264, faststart)
- **Real progress** — ffmpeg progress streamed live to the UI
- **[ShareX integration](docs/sharex.md)** — stop a recording and it opens in
  the editor, or converts automatically
- Results are saved to your Downloads folder (changeable in settings) **and**
  downloadable from the browser

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [ffmpeg](https://ffmpeg.org/) on your PATH:
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

## Run it

```sh
git clone https://github.com/bharvey88/gifify.git
cd gifify
npm install
npm start
```

Your browser opens `http://localhost:3111`. That's it.

To update later: `git pull` then `npm install` (which rebuilds the UI).

Flags and environment:

- `npm start -- --no-open` (or `GIFIFY_NO_OPEN=1`) — don't auto-open a browser
- `PORT=4000 npm start` — different port
- `GIFIFY_MAX_UPLOAD_MB=4096` — raise the 2 GB upload cap

### Windows: no terminal needed

After the first clone, double-click **`gifify-tray.vbs`** — gifify starts with
no console window and lives in the system tray. Double-click the tray icon to
open the app; right-click it for **Open gifify**, **Open output folder**, and
**Exit** (which stops the server). First run installs dependencies
automatically, and launching it again while it's running just opens the app.

Want it in the Start Menu? Create a shortcut to `gifify-tray.vbs` and move it
into `%APPDATA%\Microsoft\Windows\Start Menu\Programs`.

Prefer visible logs? `gifify.cmd` runs it in a console window instead —
close the window to stop it.

### ShareX integration

Stop a ShareX screen recording and have it open straight in gifify's editor
(or convert automatically with zero clicks). Setup takes a few minutes and has
a couple of ShareX-specific traps, so it has its own guide:
**[docs/sharex.md](docs/sharex.md)**.

## Why animated WebP?

For typical UI screen recordings, animated WebP is a fraction of the size of
GIF at noticeably better quality, and it works in every modern browser with a
plain `<img>` tag. GIF is still here for the places that require it, and the
MP4 preset is smaller still if your target supports `<video>`.

## Development

```sh
npm run dev    # Vite dev server (hot reload) + API server
npm test       # vitest: ffmpeg arg builder, job queue, trim + crop math
npm run build  # rebuild the production frontend into dist/
```

Architecture: an Express server (`server/`) spawns your native ffmpeg and
streams progress over Server-Sent Events; a Svelte single-page app (`web/`)
provides the UI. Conversions run one at a time in a FIFO queue. GIF output
uses ffmpeg's two-pass palettegen/paletteuse for much better colors than the
naive one-pass conversion.

## License

MIT
