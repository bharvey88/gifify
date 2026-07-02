// Wraps native ffmpeg/ffprobe: availability check, probing, and running
// conversion passes with progress callbacks.

import { spawn, spawnSync } from 'node:child_process';

export function toolsAvailable() {
  const check = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
  return { ffmpeg: check('ffmpeg'), ffprobe: check('ffprobe') };
}

// Returns {durationSec, width, height}.
export function probe(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-show_entries', 'stream=width,height,codec_type',
      '-of', 'json',
      filePath,
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err.trim()}`));
      try {
        const data = JSON.parse(out);
        const video = (data.streams || []).find((s) => s.codec_type === 'video') || {};
        resolve({
          durationSec: Number(data.format?.duration) || null,
          width: video.width ?? null,
          height: video.height ?? null,
        });
      } catch (e) {
        reject(new Error(`ffprobe output unparseable: ${e.message}`));
      }
    });
  });
}

// Parses "out_time=HH:MM:SS.micros" lines from ffmpeg -progress output.
export function parseOutTimeSec(chunk) {
  const m = /out_time=(\d+):(\d+):([\d.]+)/.exec(chunk);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Run one ffmpeg pass. onProgress receives seconds of output produced so far.
export function runPass(args, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { signal });
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const sec = parseOutTimeSec(String(d));
      if (sec != null) onProgress?.(sec);
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}
