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

// Effective OUTPUT clip length in seconds, for progress percentage.
// Speeding up the video shrinks the output timeline.
export function clipLengthSec(settings, videoDurationSec) {
  const start = Number(settings.startSec) || 0;
  const end =
    settings.endSec != null && Number.isFinite(Number(settings.endSec))
      ? Number(settings.endSec)
      : videoDurationSec;
  if (!Number.isFinite(end)) return null;
  const speed = numberOr(settings.speed, 1);
  return Math.max((end - start) / speed, 0.01);
}

function scaleFilter(settings) {
  const format = settings.format;
  const width = Number(settings.width) || DEFAULTS[format].width;
  const fps = Number(settings.fps) || DEFAULTS[format].fps;
  const parts = [];
  if (settings.crop) {
    const c = settings.crop;
    parts.push(`crop=${c.width}:${c.height}:${c.x}:${c.y}`);
  }
  const speed = numberOr(settings.speed, 1);
  if (speed !== 1) parts.push(`setpts=PTS/${speed}`);
  // x264 + yuv420p requires even dimensions, so mp4 gets -2 (round height to even)
  const h = format === 'mp4' ? -2 : -1;
  parts.push(`fps=${fps}`, `scale=${width}:${h}:flags=lanczos`);
  return parts.join(',');
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
          ...COMMON, ...seek, ...len, '-i', inputPath,
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
          ...COMMON, ...seek, ...len, '-i', inputPath,
          '-vf', `${vf},palettegen=stats_mode=diff`,
          palettePath,
        ],
      },
      {
        kind: 'encode',
        args: [
          ...COMMON, ...seek, ...len, '-i', inputPath, '-i', palettePath,
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
          ...COMMON, ...seek, ...len, '-i', inputPath,
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
  s.speed = clampSpeed(raw.speed);
  s.crop = normalizeCrop(raw.crop);
  if (format === 'webp') s.quality = clampInt(raw.quality, 0, 100, d.quality);
  if (format === 'gif') s.bayerScale = clampInt(raw.bayerScale, 0, 5, d.bayerScale);
  if (format === 'mp4') s.crf = clampInt(raw.crf, 0, 51, d.crf);
  return s;
}

function clampSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.max(n, 0.25), 4);
}

// Crop box in source pixels. Returns null (no crop) for missing or
// unusable boxes rather than failing the whole conversion.
function normalizeCrop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Math.round(Number(raw.x));
  const y = Math.round(Number(raw.y));
  const width = Math.round(Number(raw.width));
  const height = Math.round(Number(raw.height));
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width < 16 || height < 16) return null;
  return { x, y, width, height };
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
