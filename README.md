# 🎞️ gifify

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
- **Live results** — see the animated output and its file size right in the
  page, tweak quality/width/fps, convert again, and compare attempts
- **Presets** — Wiki WebP (24 fps, 720 px), Wiki GIF (15 fps, palette-optimized),
  Tiny MP4 (x264, faststart)
- **Real progress** — ffmpeg progress streamed live to the UI
- Results are saved to a folder you choose **and** downloadable from the browser

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

Flags and environment:

- `npm start -- --no-open` (or `GIFIFY_NO_OPEN=1`) — don't auto-open a browser
- `PORT=4000 npm start` — different port
- `GIFIFY_MAX_UPLOAD_MB=4096` — raise the 2 GB upload cap

## Why animated WebP?

For typical UI screen recordings, animated WebP is a fraction of the size of
GIF at noticeably better quality, and it works in every modern browser with a
plain `<img>` tag. GIF is still here for the places that require it, and the
MP4 preset is smaller still if your target supports `<video>`.

## Development

```sh
npm run dev    # Vite dev server (hot reload) + API server
npm test       # vitest: ffmpeg arg builder, job queue, trim math
npm run build  # rebuild the production frontend into dist/
```

Architecture: an Express server (`server/`) spawns your native ffmpeg and
streams progress over Server-Sent Events; a Svelte single-page app (`web/`)
provides the UI. Conversions run one at a time in a FIFO queue. GIF output
uses ffmpeg's two-pass palettegen/paletteuse for much better colors than the
naive one-pass conversion.

## License

MIT
