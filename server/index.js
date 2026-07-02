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

app.post('/api/videos', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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
    res.json({ id, name: video.name, durationSec: meta.durationSec, width: meta.width, height: meta.height });
  } catch (err) {
    fs.rmSync(path.dirname(req.file.path), { recursive: true, force: true });
    res.status(422).json({ error: `Could not read video: ${err.message}` });
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

app.post('/api/convert', (req, res) => {
  const video = videos.get(req.body?.videoId);
  if (!video) return res.status(404).json({ error: 'Unknown video' });

  let jobSettings;
  try {
    jobSettings = normalizeSettings(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const id = newId();
  const job = {
    id,
    videoId: video.id,
    settings: jobSettings,
    status: 'queued',
    pct: 0,
    error: null,
    outPath: null,
    attemptPath: null,
    bytes: null,
    listeners: new Set(),
  };
  jobs.set(id, job);

  queue.push(() => runJob(job, video)).catch(() => {}); // errors recorded on the job itself
  res.json({ jobId: id });
});

function emit(job, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const listener of job.listeners) listener.write(data);
}

async function runJob(job, video) {
  job.status = 'running';
  emit(job, { status: 'running', pct: 0 });

  const base = path.parse(video.name).name;
  const ext = job.settings.format;
  const attemptPath = path.join(video.dir, `attempt_${job.id}.${ext}`);
  const palettePath = path.join(video.dir, `palette_${job.id}.png`);
  const clipLen = clipLengthSec(job.settings, video.durationSec);
  const passes = buildPasses(job.settings, video.filePath, attemptPath, palettePath);
  // GIF pass 1 (palette) is quick relative to pass 2; weight it 40/60.
  const weights = passes.length === 2 ? [[0, 40], [40, 100]] : [[0, 100]];

  try {
    for (let i = 0; i < passes.length; i++) {
      const [from, to] = weights[i];
      await runPass(passes[i].args, (sec) => {
        if (!clipLen) return;
        const pct = Math.min(from + ((sec / clipLen) * (to - from)), to);
        job.pct = Math.round(pct);
        emit(job, { status: 'running', pct: job.pct });
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

app.listen(PORT, () => {
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
