// In-memory state (videos, jobs) + persisted settings + temp workspace.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const SETTINGS_FILE = path.join(os.homedir(), '.gifify.json');
const WORK_ROOT = path.join(os.tmpdir(), 'gifify');

export const videos = new Map(); // id -> {id, name, filePath, dir, durationSec, width, height}
export const jobs = new Map();   // id -> {id, videoId, settings, status, pct, error, outPath, attemptPath, bytes, listeners}

export function newId() {
  return crypto.randomBytes(8).toString('hex');
}

export function makeVideoDir(id) {
  const dir = path.join(WORK_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadSettings() {
  // Default to ~/Downloads (present on Windows/macOS and most Linux setups);
  // fall back to an output/ dir in the repo if it doesn't exist.
  const downloads = path.join(os.homedir(), 'Downloads');
  const defaults = {
    outputDir: fs.existsSync(downloads) ? downloads : path.join(PROJECT_ROOT, 'output'),
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export function removeVideo(id) {
  const video = videos.get(id);
  if (!video) return;
  videos.delete(id);
  for (const [jobId, job] of jobs) {
    if (job.videoId === id) jobs.delete(jobId);
  }
  fs.rmSync(video.dir, { recursive: true, force: true });
}

export function cleanupAll() {
  fs.rmSync(WORK_ROOT, { recursive: true, force: true });
}
