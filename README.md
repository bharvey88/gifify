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

If you record with [ShareX](https://getsharex.com/), gifify can pick up right
where the recording stops. Two custom uploaders live in [`sharex/`](sharex/):

- **gifify (open editor)** — the recording lands in gifify's trim editor in a
  new browser tab, ready to trim, crop, and convert.
- **gifify (auto WebP)** — converts immediately with the Wiki WebP preset and
  puts the output file path on your clipboard. No trimming, zero clicks.

Setup:

1. Double-click **`sharex\install.cmd`** inside your cloned gifify folder and
   accept ShareX's two import prompts. (The `.sxcu` files are on your disk
   already, no downloading; `install.cmd` just opens both for you.)
2. In ShareX: **Destinations → File uploader → Custom file uploader**. The
   gifify entries never appear in that menu by name; custom uploaders live one
   level deeper.
3. **Destinations → Custom uploader settings...**: both gifify entries show in
   the list. In the bottom-left dropdowns, set **File uploader** to the one you
   want (the other dropdowns don't matter for recordings).
4. In the main window's left menu, click **After capture tasks** and check
   **Upload image to host**. Despite the name it applies to recordings too,
   and it's unchecked in a default ShareX install.

**Gotcha:** if ShareX says the task completed but nothing shows up in gifify,
it's almost always step 4. Without **Upload image to host**, ShareX saves the
recording and stops, so "completed" just means "saved to disk". You can
confirm in ShareX's **History**: an entry with a file path but an empty URL
column never attempted an upload.

Also don't use the **Test** button in the Custom uploader settings window;
ShareX tests with a fake non-video file, which gifify correctly rejects. Test
by recording a short **Screen recording** (plain, not the GIF variant) with
gifify running. Record with plain
**Screen recording** (MP4), not **Screen recording (GIF)** — the MP4 is the
full-quality source and gifify does the GIF/WebP conversion properly from it.

gifify has to be running (tray icon or `npm start`) when the recording
finishes, or ShareX will report a connection error.

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
