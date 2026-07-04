import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { toolsAvailable, probe, runPass } from './ffmpeg.js';
import { buildPasses, normalizeSettings, clipLengthSec, PRESETS } from './ffmpegArgs.js';
import { JobQueue } from './queue.js';
import {
  PROJECT_ROOT, videos, jobs, newId, makeVideoDir,
  loadSettings, saveSettings, removeVideo, cleanupAll,
} from './store.js';

const PORT = process.env.PORT || 3111;
const MAX_UPLOAD_BYTES = (Number(process.env.GIFIFY_MAX_UPLOAD_MB) || 2048) * 1024 * 1024;

const app = express();
app.use(express.json());

const queue = new JobQueue();
let settings = loadSettings();
const tools = toolsAvailable();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const id = newId();
      req.videoId = id;
      cb(null, makeVideoDir(id));
    },
    filename: (req, file, cb) => cb(null, sanitizeName(file.originalname)),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function sanitizeName(name) {
  return path.basename(name).replace(/[^\w.\- ]+/g, '_');
}

// ---- health / presets / settings ----

app.get('/api/health', (req, res) => {
  res.json({ ok: true, tools, maxUploadBytes: MAX_UPLOAD_BYTES });
});

app.get('/api/presets', (req, res) => res.json(PRESETS));

app.get('/api/settings', (req, res) => res.json(settings));

app.put('/api/settings', (req, res) => {
  const outputDir = String(req.body?.outputDir || '').trim();
  if (!outputDir) return res.status(400).json({ error: 'outputDir is required' });
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.accessSync(outputDir, fs.constants.W_OK);
  } catch (err) {
    return res.status(400).json({ error: `Output folder not writable: ${outputDir} (${err.message})` });
  }
  settings = { ...settings, outputDir };
  saveSettings(settings);
  res.json(settings);
});

// ---- videos ----

// Probe an uploaded file and register it as a video card. Throws on
// unreadable input (and cleans up the temp dir).
async function registerUpload(req) {
  const id = req.videoId;
  try {
    const meta = await probe(req.file.path);
    const video = {
      id,
      name: req.file.originalname,
      filePath: req.file.path,
      dir: path.dirname(req.file.path),
      ...meta,
    };
    videos.set(id, video);
    return video;
  } catch (err) {
    fs.rmSync(path.dirname(req.file.path), { recursive: true, force: true });
    throw new Error(`Could not read video: ${err.message}`);
  }
}

function videoSummary(v) {
  return { id: v.id, name: v.name, durationSec: v.durationSec, width: v.width, height: v.height };
}

app.get('/api/videos', (req, res) => {
  res.json([...videos.values()].map(videoSummary));
});

app.post('/api/videos', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    res.json(videoSummary(await registerUpload(req)));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

app.get('/api/videos/:id/stream', (req, res) => {
  const video = videos.get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Unknown video' });
  res.sendFile(video.filePath); // express handles Range requests
});

app.delete('/api/videos/:id', (req, res) => {
  removeVideo(req.params.id);
  res.json({ ok: true });
});

// ---- conversion jobs ----

// Create a job and enqueue it. Returns {job, done} where done resolves when
// the conversion finishes (job.status then reflects the outcome).
function createJob(video, jobSettings) {
  const id = newId();
  const job = {
    id,
    videoId: video.id,
    settings: jobSettings,
    status: 'queued',
    stage: null,
    pct: 0,
    error: null,
    outPath: null,
    attemptPath: null,
    bytes: null,
    listeners: new Set(),
  };
  jobs.set(id, job);
  const done = queue.push(() => runJob(job, video)).catch(() => {}); // errors recorded on the job itself
  return { job, done };
}

app.post('/api/convert', (req, res) => {
  const video = videos.get(req.body?.videoId);
  if (!video) return res.status(404).json({ error: 'Unknown video' });

  let jobSettings;
  try {
    jobSettings = normalizeSettings(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { job } = createJob(video, jobSettings);
  res.json({ jobId: job.id });
});

// ---- ShareX integration ----
// POST a recording here from a ShareX custom uploader (see sharex/*.sxcu).
//   ?mode=edit (default): register the clip and open the gifify editor on it.
//   ?mode=convert: convert immediately with a preset (?preset=wiki-webp)
//   and respond with the saved output path once it's done.
app.post('/api/sharex', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let video;
  try {
    video = await registerUpload(req);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const mode = req.query.mode === 'convert' ? 'convert' : 'edit';
  const editUrl = `http://localhost:${PORT}/?video=${video.id}`;

  if (mode === 'edit') {
    if (req.query.open !== '0') openBrowser(editUrl);
    return res.json({ url: editUrl, ...videoSummary(video) });
  }

  const presetKey = req.query.preset || 'wiki-webp';
  const preset = PRESETS[presetKey];
  if (!preset) {
    return res.status(400).json({ error: `Unknown preset: ${presetKey} (have: ${Object.keys(PRESETS).join(', ')})` });
  }

  const { job, done } = createJob(video, normalizeSettings(preset));
  await done;
  if (job.status !== 'done') {
    return res.status(500).json({ error: job.error || 'Conversion failed' });
  }
  if (!job.outPath) {
    return res.status(500).json({ error: 'Converted, but could not save to the output folder' });
  }
  res.json({ url: job.outPath, bytes: job.bytes });
});

function emit(job, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const listener of job.listeners) listener.write(data);
}

async function runJob(job, video) {
  job.status = 'running'; // each pass emits its own stage event below

  const base = path.parse(video.name).name;
  const ext = job.settings.format;
  const attemptPath = path.join(video.dir, `attempt_${job.id}.${ext}`);
  const palettePath = path.join(video.dir, `palette_${job.id}.png`);
  const clipLen = clipLengthSec(job.settings, video.durationSec);
  const passes = buildPasses(job.settings, video.filePath, attemptPath, palettePath);

  try {
    for (const pass of passes) {
      // palettegen's only output is a single palette image, so it emits no
      // usable out_time — report that pass as indeterminate ('palette' stage)
      // and map the real encode pass to 0-100%.
      job.stage = pass.kind;
      if (pass.kind === 'palette') {
        emit(job, { status: 'running', stage: 'palette' });
        await runPass(pass.args, null);
        continue;
      }
      emit(job, { status: 'running', stage: 'encode', pct: job.pct });
      await runPass(pass.args, (sec) => {
        if (!clipLen) return;
        job.pct = Math.round(Math.min((sec / clipLen) * 100, 100));
        emit(job, { status: 'running', stage: 'encode', pct: job.pct });
      });
    }

    job.bytes = fs.statSync(attemptPath).size;
    job.attemptPath = attemptPath;

    // Also save to the configured output folder.
    let saved = null;
    let saveError = null;
    try {
      fs.mkdirSync(settings.outputDir, { recursive: true });
      saved = path.join(settings.outputDir, `${base}.${ext}`);
      fs.copyFileSync(attemptPath, saved);
    } catch (err) {
      saved = null;
      saveError = `Could not save to ${settings.outputDir}: ${err.message}`;
    }
    job.outPath = saved;

    job.status = 'done';
    job.pct = 100;
    emit(job, { status: 'done', pct: 100, bytes: job.bytes, outPath: saved, saveError });
  } catch (err) {
    job.status = 'failed';
    job.error = String(err.message || err);
    emit(job, { status: 'failed', error: job.error });
  } finally {
    fs.rmSync(palettePath, { force: true });
    for (const listener of job.listeners) listener.end();
    job.listeners.clear();
  }
}

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (job.status === 'done') {
    res.write(`data: ${JSON.stringify({ status: 'done', pct: 100, bytes: job.bytes, outPath: job.outPath })}\n\n`);
    return res.end();
  }
  if (job.status === 'failed') {
    res.write(`data: ${JSON.stringify({ status: 'failed', error: job.error })}\n\n`);
    return res.end();
  }

  // Send the current state immediately — stage events are emitted once per
  // pass and would otherwise be missed if the client connects mid-pass.
  if (job.status === 'running') {
    res.write(`data: ${JSON.stringify({ status: 'running', stage: job.stage, pct: job.pct })}\n\n`);
  }

  job.listeners.add(res);
  req.on('close', () => job.listeners.delete(res));
});

app.get('/api/jobs/:id/result', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.attemptPath) return res.status(404).json({ error: 'No result for this job' });
  const download = 'download' in req.query;
  const video = videos.get(job.videoId);
  const base = video ? path.parse(video.name).name : 'gifify';
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${base}.${job.settings.format}"`);
  res.sendFile(job.attemptPath);
});

// ---- static frontend + startup ----

const DIST = path.join(PROJECT_ROOT, 'dist');
app.use(express.static(DIST));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB upload limit` });
  }
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

process.on('exit', cleanupAll);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Bind to loopback only: gifify accepts arbitrary file uploads and runs
// ffmpeg on them, so it should never be reachable from the LAN.
app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`gifify running at ${url}`);
  if (!tools.ffmpeg || !tools.ffprobe) {
    console.warn('WARNING: ffmpeg/ffprobe not found on PATH — the UI will show setup instructions.');
  }
  if (!process.argv.includes('--no-open') && !process.env.GIFIFY_NO_OPEN) {
    openBrowser(url);
  }
});

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  else if (platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' });
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
}
