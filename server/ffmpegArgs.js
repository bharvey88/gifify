// Pure builder for ffmpeg argument arrays. No I/O — fully unit-testable.
// Mirrors the original Convert-VideosToGifs.ps1 invocations.

export const PRESETS = {
  'wiki-webp': { format: 'webp', fps: 24, width: 720, quality: 75 },
  'wiki-gif': { format: 'gif', fps: 15, width: 720, bayerScale: 5 },
  'tiny-mp4': { format: 'mp4', fps: 30, width: 720, crf: 28 },
};

export const DEFAULTS = {
  webp: { fps: 24, width: 720, quality: 75 },
  gif: { fps: 15, width: 720, bayerScale: 5 },
  mp4: { fps: 30, width: 720, crf: 28 },
};

const COMMON = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y'];

function trimArgs(settings) {
  const seek = [];
  const len = [];
  const start = Number(settings.startSec) || 0;
  if (start > 0) seek.push('-ss', String(start));
  if (settings.endSec != null && Number.isFinite(Number(settings.endSec))) {
    const clipLen = Number(settings.endSec) - start;
    if (clipLen > 0) len.push('-t', String(clipLen));
  }
  return { seek, len };
}

// Effective clip length in seconds, for progress percentage.
export function clipLengthSec(settings, videoDurationSec) {
  const start = Number(settings.startSec) || 0;
  const end =
    settings.endSec != null && Number.isFinite(Number(settings.endSec))
      ? Number(settings.endSec)
      : videoDurationSec;
  if (!Number.isFinite(end)) return null;
  return Math.max(end - start, 0.01);
}

function scaleFilter(settings) {
  const format = settings.format;
  const width = Number(settings.width) || DEFAULTS[format].width;
  const fps = Number(settings.fps) || DEFAULTS[format].fps;
  return `fps=${fps},scale=${width}:-1:flags=lanczos`;
}

// Returns an array of {kind, args} passes. webp/mp4 have one 'encode' pass;
// gif has two: 'palette' (palettegen — emits no usable progress, since its
// only output is a single palette image) then 'encode' (paletteuse).
export function buildPasses(settings, inputPath, outputPath, palettePath) {
  const { format } = settings;
  const { seek, len } = trimArgs(settings);
  const vf = scaleFilter(settings);

  if (format === 'webp') {
    const quality = numberOr(settings.quality, DEFAULTS.webp.quality);
    return [
      {
        kind: 'encode',
        args: [
          ...COMMON, ...seek, '-i', inputPath, ...len,
          '-vf', vf,
          '-loop', '0', '-an', '-vsync', '0',
          '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(quality), '-compression_level', '6',
          outputPath,
        ],
      },
    ];
  }

  if (format === 'gif') {
    const bayerScale = numberOr(settings.bayerScale, DEFAULTS.gif.bayerScale);
    return [
      {
        kind: 'palette',
        args: [
          ...COMMON, ...seek, '-i', inputPath, ...len,
          '-vf', `${vf},palettegen=stats_mode=diff`,
          palettePath,
        ],
      },
      {
        kind: 'encode',
        args: [
          ...COMMON, ...seek, '-i', inputPath, '-i', palettePath, ...len,
          '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=${bayerScale}:diff_mode=rectangle`,
          outputPath,
        ],
      },
    ];
  }

  if (format === 'mp4') {
    const crf = numberOr(settings.crf, DEFAULTS.mp4.crf);
    return [
      {
        kind: 'encode',
        args: [
          ...COMMON, ...seek, '-i', inputPath, ...len,
          '-vf', `${vf},format=yuv420p`,
          '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-movflags', '+faststart',
          outputPath,
        ],
      },
    ];
  }

  throw new Error(`Unknown format: ${format}`);
}

// Validate and normalize settings from the client. Throws on bad input.
export function normalizeSettings(raw) {
  const format = raw.format;
  if (!['webp', 'gif', 'mp4'].includes(format)) throw new Error(`Invalid format: ${format}`);
  const d = DEFAULTS[format];
  const s = {
    format,
    fps: clampInt(raw.fps, 1, 60, d.fps),
    width: clampInt(raw.width, 16, 3840, d.width),
    startSec: Math.max(Number(raw.startSec) || 0, 0),
    endSec: raw.endSec != null && Number.isFinite(Number(raw.endSec)) ? Number(raw.endSec) : null,
  };
  if (s.endSec != null && s.endSec <= s.startSec) throw new Error('endSec must be after startSec');
  if (format === 'webp') s.quality = clampInt(raw.quality, 0, 100, d.quality);
  if (format === 'gif') s.bayerScale = clampInt(raw.bayerScale, 0, 5, d.bayerScale);
  if (format === 'mp4') s.crf = clampInt(raw.crf, 0, 51, d.crf);
  return s;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}
