import { describe, it, expect } from 'vitest';
import { buildPasses, normalizeSettings, clipLengthSec } from './ffmpegArgs.js';

const IN = 'C:/videos/demo.mp4';
const OUT = 'C:/tmp/out.webp';
const PALETTE = 'C:/tmp/palette.png';

describe('normalizeSettings', () => {
  it('applies per-format defaults', () => {
    expect(normalizeSettings({ format: 'webp' })).toMatchObject({
      format: 'webp', fps: 24, width: 720, quality: 75, startSec: 0, endSec: null,
    });
    expect(normalizeSettings({ format: 'gif' })).toMatchObject({ fps: 15, bayerScale: 5 });
    expect(normalizeSettings({ format: 'mp4' })).toMatchObject({ fps: 30, crf: 28 });
  });

  it('clamps out-of-range values', () => {
    const s = normalizeSettings({ format: 'webp', fps: 500, width: 5, quality: -20 });
    expect(s.fps).toBe(60);
    expect(s.width).toBe(16);
    expect(s.quality).toBe(0);
  });

  it('rejects bad formats and inverted trims', () => {
    expect(() => normalizeSettings({ format: 'avi' })).toThrow(/Invalid format/);
    expect(() => normalizeSettings({ format: 'gif', startSec: 10, endSec: 5 })).toThrow(/endSec/);
  });

  it('ignores junk numeric input, falling back to defaults', () => {
    const s = normalizeSettings({ format: 'webp', fps: 'abc', width: null, quality: undefined });
    expect(s).toMatchObject({ fps: 24, width: 720, quality: 75 });
  });
});

describe('buildPasses', () => {
  it('builds a single webp pass matching the original script', () => {
    const s = normalizeSettings({ format: 'webp', startSec: 0 });
    const passes = buildPasses(s, IN, OUT, PALETTE);
    expect(passes).toHaveLength(1);
    const args = passes[0].args;
    expect(args).toContain('libwebp');
    expect(args.join(' ')).toContain('-vf fps=24,scale=720:-1:flags=lanczos');
    expect(args.join(' ')).toContain('-lossless 0 -q:v 75 -compression_level 6');
    expect(args.join(' ')).toContain('-loop 0 -an -vsync 0');
    expect(args[args.length - 1]).toBe(OUT);
    expect(args).not.toContain('-ss'); // no trim requested
    expect(args).not.toContain('-t');
  });

  it('puts both -ss and -t before -i (input options) for trims', () => {
    // -t after -i limits the OUTPUT timeline, which breaks once setpts
    // (speed) compresses timestamps: 2x speed would pull in twice the
    // requested source range. As input options they bound the source read.
    const s = normalizeSettings({ format: 'webp', startSec: 3, endSec: 19 });
    const args = buildPasses(s, IN, OUT, PALETTE)[0].args;
    const ss = args.indexOf('-ss');
    const i = args.indexOf('-i');
    const t = args.indexOf('-t');
    expect(ss).toBeGreaterThan(-1);
    expect(ss).toBeLessThan(i);
    expect(t).toBeGreaterThan(-1);
    expect(t).toBeLessThan(i);
    expect(args[ss + 1]).toBe('3');
    expect(args[t + 1]).toBe('16'); // clip length = end - start (input timeline)
  });

  it('tags passes so the UI can show indeterminate progress during palettegen', () => {
    const gif = buildPasses(normalizeSettings({ format: 'gif' }), IN, 'C:/tmp/out.gif', PALETTE);
    expect(gif.map((p) => p.kind)).toEqual(['palette', 'encode']);
    const webp = buildPasses(normalizeSettings({ format: 'webp' }), IN, OUT, PALETTE);
    expect(webp.map((p) => p.kind)).toEqual(['encode']);
    const mp4 = buildPasses(normalizeSettings({ format: 'mp4' }), IN, 'C:/tmp/out.mp4', PALETTE);
    expect(mp4.map((p) => p.kind)).toEqual(['encode']);
  });

  it('builds two gif passes with trim applied to both', () => {
    const s = normalizeSettings({ format: 'gif', startSec: 2, endSec: 10 });
    const passes = buildPasses(s, IN, 'C:/tmp/out.gif', PALETTE);
    expect(passes).toHaveLength(2);
    const [p1, p2] = passes.map((p) => p.args);
    expect(p1.join(' ')).toContain('palettegen=stats_mode=diff');
    expect(p1[p1.length - 1]).toBe(PALETTE);
    expect(p2.join(' ')).toContain('paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle');
    for (const args of [p1, p2]) {
      expect(args[args.indexOf('-ss') + 1]).toBe('2');
      expect(args[args.indexOf('-t') + 1]).toBe('8');
      expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-i')); // input option
    }
    // pass 2 uses the palette as a second input
    expect(p2.filter((a) => a === '-i')).toHaveLength(2);
  });

  it('builds an mp4 pass with yuv420p and faststart', () => {
    const s = normalizeSettings({ format: 'mp4', crf: 24 });
    const args = buildPasses(s, IN, 'C:/tmp/out.mp4', PALETTE)[0].args;
    expect(args.join(' ')).toContain('format=yuv420p');
    // x264 + yuv420p requires even dimensions; -2 keeps the height even
    // (odd heights are easy to hit once cropping is involved)
    expect(args.join(' ')).toContain('scale=720:-2:flags=lanczos');
    expect(args.join(' ')).toContain('-c:v libx264 -preset slow -crf 24 -movflags +faststart');
    expect(args).toContain('-an');
  });
});

describe('speed control', () => {
  it('defaults to 1x and adds no setpts filter', () => {
    const s = normalizeSettings({ format: 'webp' });
    expect(s.speed).toBe(1);
    const args = buildPasses(s, IN, OUT, PALETTE)[0].args;
    expect(args.join(' ')).not.toContain('setpts');
  });

  it('inserts setpts before fps so output framerate stays correct', () => {
    const s = normalizeSettings({ format: 'webp', speed: 2 });
    const args = buildPasses(s, IN, OUT, PALETTE)[0].args;
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe('setpts=PTS/2,fps=24,scale=720:-1:flags=lanczos');
  });

  it('applies speed to both gif passes', () => {
    const s = normalizeSettings({ format: 'gif', speed: 1.5 });
    const passes = buildPasses(s, IN, 'C:/tmp/out.gif', PALETTE);
    for (const p of passes) {
      expect(p.args.join(' ')).toContain('setpts=PTS/1.5,fps=15');
    }
  });

  it('clamps speed to a sane range', () => {
    expect(normalizeSettings({ format: 'webp', speed: 100 }).speed).toBe(4);
    expect(normalizeSettings({ format: 'webp', speed: 0 }).speed).toBe(1);
    expect(normalizeSettings({ format: 'webp', speed: 0.1 }).speed).toBe(0.25);
  });

  it('shortens the effective clip length for progress math', () => {
    expect(clipLengthSec({ startSec: 0, endSec: 20, speed: 2 }, 60)).toBe(10);
    expect(clipLengthSec({ startSec: 0, endSec: null, speed: 2 }, 60)).toBe(30);
  });
});

describe('crop', () => {
  it('accepts a valid crop box and puts crop first in the filter chain', () => {
    const s = normalizeSettings({ format: 'webp', crop: { x: 10, y: 20, width: 640, height: 360 } });
    expect(s.crop).toEqual({ x: 10, y: 20, width: 640, height: 360 });
    const args = buildPasses(s, IN, OUT, PALETTE)[0].args;
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe('crop=640:360:10:20,fps=24,scale=720:-1:flags=lanczos');
  });

  it('rounds crop values to integers and rejects tiny or negative boxes', () => {
    const s = normalizeSettings({ format: 'webp', crop: { x: 1.6, y: 2.4, width: 640.7, height: 360.2 } });
    expect(s.crop).toEqual({ x: 2, y: 2, width: 641, height: 360 });
    expect(normalizeSettings({ format: 'webp', crop: { x: 0, y: 0, width: 5, height: 5 } }).crop).toBeNull();
    expect(normalizeSettings({ format: 'webp', crop: { x: -5, y: 0, width: 100, height: 100 } }).crop).toBeNull();
    expect(normalizeSettings({ format: 'webp' }).crop).toBeNull();
  });

  it('combines crop and speed in the right order', () => {
    const s = normalizeSettings({
      format: 'gif', speed: 2, crop: { x: 0, y: 0, width: 800, height: 600 },
    });
    const vf = buildPasses(s, IN, 'C:/tmp/out.gif', PALETTE)[0].args;
    expect(vf[vf.indexOf('-vf') + 1]).toBe('crop=800:600:0:0,setpts=PTS/2,fps=15,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff');
  });
});

describe('mp4 two-pass bitrate targeting', () => {
  it('builds analyze + encode passes when videoBitrate is set', () => {
    const s = normalizeSettings({ format: 'mp4', videoBitrate: 2_000_000 });
    const passes = buildPasses(s, IN, 'C:/tmp/out.mp4', PALETTE);
    expect(passes.map((p) => p.kind)).toEqual(['analyze', 'encode']);
    const [p1, p2] = passes.map((p) => p.args.join(' '));
    expect(p1).toContain('-b:v 2000000');
    expect(p1).toContain('-pass 1');
    expect(p1).toContain('-f null');
    expect(passes[0].args.at(-1)).toMatch(/^(NUL|\/dev\/null)$/); // discards output
    expect(p2).toContain('-pass 2');
    expect(p2).toContain('-movflags +faststart');
    expect(passes[1].args.at(-1)).toBe('C:/tmp/out.mp4');
    // both passes share the passlog and the filter chain
    expect(p1).toContain('-passlogfile');
    expect(p2).toContain('-passlogfile');
    expect(p1).toContain('format=yuv420p');
    expect(p2).toContain('format=yuv420p');
  });

  it('ignores videoBitrate for non-mp4 and stays single-pass CRF without it', () => {
    const webp = normalizeSettings({ format: 'webp', videoBitrate: 2_000_000 });
    expect(webp.videoBitrate).toBeUndefined();
    const mp4 = normalizeSettings({ format: 'mp4' });
    expect(buildPasses(mp4, IN, 'C:/tmp/out.mp4', PALETTE)).toHaveLength(1);
  });

  it('carries the probe flag through normalization', () => {
    expect(normalizeSettings({ format: 'webp', probe: true }).probe).toBe(true);
    expect(normalizeSettings({ format: 'webp' }).probe).toBe(false);
  });
});

describe('clipLengthSec', () => {
  it('uses endSec - startSec when trimmed', () => {
    expect(clipLengthSec({ startSec: 3, endSec: 19 }, 60)).toBe(16);
  });
  it('falls back to full video duration', () => {
    expect(clipLengthSec({ startSec: 0, endSec: null }, 42)).toBe(42);
  });
  it('accounts for start offset against full duration', () => {
    expect(clipLengthSec({ startSec: 10, endSec: null }, 42)).toBe(32);
  });
});
