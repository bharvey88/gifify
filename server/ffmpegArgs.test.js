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

  it('puts -ss before -i and -t after for trims', () => {
    const s = normalizeSettings({ format: 'webp', startSec: 3, endSec: 19 });
    const args = buildPasses(s, IN, OUT, PALETTE)[0].args;
    const ss = args.indexOf('-ss');
    const i = args.indexOf('-i');
    const t = args.indexOf('-t');
    expect(ss).toBeGreaterThan(-1);
    expect(ss).toBeLessThan(i);
    expect(t).toBeGreaterThan(i);
    expect(args[ss + 1]).toBe('3');
    expect(args[t + 1]).toBe('16'); // clip length = end - start
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
    }
    // pass 2 uses the palette as a second input
    expect(p2.filter((a) => a === '-i')).toHaveLength(2);
  });

  it('builds an mp4 pass with yuv420p and faststart', () => {
    const s = normalizeSettings({ format: 'mp4', crf: 24 });
    const args = buildPasses(s, IN, 'C:/tmp/out.mp4', PALETTE)[0].args;
    expect(args.join(' ')).toContain('format=yuv420p');
    expect(args.join(' ')).toContain('-c:v libx264 -preset slow -crf 24 -movflags +faststart');
    expect(args).toContain('-an');
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
