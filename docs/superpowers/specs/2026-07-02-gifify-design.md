# Gifify — Design

**Date:** 2026-07-02
**Status:** Approved by Brandon (brainstorming session)

## Purpose

A local web app for converting screen-recording videos into animated WebP, GIF,
or small MP4 clips for the Apollo wiki. Replaces the `Convert-VideosToGifs.ps1`
PowerShell scripts with a browser UI that supports visual trimming, live
preview, and quick quality iteration. Will be published as a public GitHub repo
(`bharvey88/gifify`, MIT) and featured in a blog post on smarthomesellout.com.

Success criteria: drop a video, trim it on a scrubber, hit a preset, see the
animated result and file size, and have the file both saved to disk and
downloadable — in under a minute per clip.

## Architecture

Local server + browser UI (chosen over ffmpeg.wasm because native ffmpeg speed
was preferred; sharing happens via the GitHub repo rather than a hosted URL).

- **`server/`** — Node + Express. Spawns the user's native ffmpeg/ffprobe
  (must be on PATH). REST + Server-Sent Events API.
- **`web/`** — Svelte + Vite single-page app.
- **Run modes:**
  - `npm start` — serves the pre-built frontend from Express, opens
    `http://localhost:3111`. This is the path blog readers use:
    `git clone` → `npm install` → `npm start`. The frontend build must not be
    a step readers perform: a `postinstall` script runs the Vite build, so
    `dist/` is generated during `npm install` and never committed.
  - `npm run dev` — Vite dev server + Express with hot reload, for development.

### Data flow (one conversion)

1. User drops video file(s) on the page. Each uploads via `POST /api/videos`.
   Server stores it in a temp workspace, probes duration/resolution with
   ffprobe, returns metadata + a stream URL for the `<video>` scrubber.
2. User sets trim in/out points, picks a preset or adjusts settings, clicks
   Convert. Browser calls `POST /api/convert` with
   `{videoId, format, fps, width, quality|crf|bayerScale, startSec, endSec}`.
3. Server enqueues the job (one ffmpeg at a time), spawns ffmpeg, parses its
   progress output, and streams percent-complete over SSE
   (`GET /api/jobs/:id/events`).
4. On success the server saves the output to the configured output folder and
   exposes it for inline preview + download. UI shows the animated result and
   file size; user iterates on settings and reconverts.

### API sketch

- `POST /api/videos` — multipart upload → `{id, name, durationSec, width, height}`
- `GET /api/videos/:id/stream` — range-request video streaming for the player
- `DELETE /api/videos/:id` — remove card + temp files
- `POST /api/convert` — settings → `{jobId}`
- `GET /api/jobs/:id/events` — SSE progress (`{pct}` … `{done, outPath, bytes}` / `{error, stderr}`)
- `GET /api/jobs/:id/result` — the converted file (preview + download)
- `GET/PUT /api/settings` — output folder, persisted server-side between sessions

## UI

Single page, three zones:

1. **Drop zone / queue strip (top).** Drag-and-drop anywhere (or click to
   browse). Each video is a card: filename, duration, thumbnail, status
   (waiting / converting N% / done + size / failed). Click a card to load it in
   the editor. Cards keep their own settings. "Convert all" runs the queue.
2. **Editor (middle).** HTML5 video player; timeline scrubber below with
   draggable start/end handles and readout like `0:03.2 – 0:19.0 (15.8s clip)`.
   "Set start/end to playhead" buttons; loop-the-trimmed-range preview playback.
3. **Settings + result (bottom, side by side).**
   - Left: preset buttons — **Wiki WebP** (webp, 24 fps, 720 px, q75),
     **Wiki GIF** (gif, 15 fps, 720 px, bayer 5), **Tiny MP4** (mp4, 30 fps,
     crf 28) — plus an Advanced expander: format toggle, width, fps, and the
     format-appropriate quality control (WebP q / GIF bayer scale / MP4 CRF).
   - Right: result panel — animated preview of last conversion, file size,
     Download button, "saved to `<folder>`" confirmation, and a per-video
     attempt history (e.g. "q75 → 2.1 MB, q60 → 1.4 MB") with re-download of
     any earlier attempt.

Output folder configurable via a settings gear; default is the source video's
folder; persisted server-side.

## Conversion engine

Direct port of the PowerShell script's ffmpeg invocations:

- **WebP:** `-vf fps=$fps,scale=$width:-1:flags=lanczos -loop 0 -an -vsync 0
  -c:v libwebp -lossless 0 -q:v $q -compression_level 6`
- **GIF:** two-pass — `palettegen=stats_mode=diff`, then
  `paletteuse=dither=bayer:bayer_scale=$bs:diff_mode=rectangle`
- **MP4:** `-vf fps,scale,format=yuv420p -an -c:v libx264 -preset slow
  -crf $crf -movflags +faststart`
- **Trim:** `-ss <start>` before `-i`, `-t <length>` after; applied to both GIF
  passes identically.

Startup check: if ffmpeg/ffprobe are missing from PATH, the UI renders a setup
screen with install instructions (`winget install Gyan.FFmpeg`, brew, apt)
instead of failing in the terminal.

## Error handling

- ffmpeg stderr captured per job; failed cards turn red with the actual error
  in an expandable detail. No silent failures.
- Upload size cap, configurable, default 2 GB.
- Temp workspace cleaned when a card is deleted and on server shutdown.
- Unwritable output folder → surfaced in the UI with the offending path.

## Testing

- **Vitest (server):** ffmpeg argument builder (settings → exact expected arg
  arrays, including both GIF passes and trim args) and queue state machine.
- **Vitest (web):** trim math (playhead/drag → start/end times).
- **Manual e2e:** real conversion of a sample clip; output quality is verified
  by eye, not mocked.

## Repo & distribution

- Public GitHub repo `bharvey88/gifify`, MIT license.
- README: hero screen-recording (made with gifify itself), setup for
  Windows/macOS/Linux, screenshots.
- No hosted instance; sharing = clone the repo. Blog post covers: the problem,
  the script era, the app, before/after file sizes.

## Out of scope (YAGNI)

- Multi-user / hosted deployment, auth, HTTPS.
- Cropping, text overlays, speed changes, or any editing beyond trim.
- Parallel ffmpeg jobs.
- Packaging as a desktop app.
