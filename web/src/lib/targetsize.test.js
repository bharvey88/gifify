import { describe, it, expect } from 'vitest';
import {
  initSearch, nextProbe, recordResult, axisToSettings, describeAxis, MAX_ATTEMPTS,
  sampleWindow, estimateFullBytes, mp4BitrateFor, SAMPLE_SEC,
} from './targetsize.js';

describe('sampling helpers', () => {
  it('takes the middle SAMPLE_SEC seconds of longer clips', () => {
    const w = sampleWindow(10, 30); // 20s clip
    expect(w.endSec - w.startSec).toBeCloseTo(SAMPLE_SEC);
    expect((w.startSec + w.endSec) / 2).toBeCloseTo(20);
  });
  it('uses the whole clip when it is already short', () => {
    expect(sampleWindow(2, 4)).toEqual({ startSec: 2, endSec: 4 });
  });
  it('scales sample bytes to the full length', () => {
    expect(estimateFullBytes(1_000_000, 3, 30)).toBe(10_000_000);
  });
  it('computes an mp4 bitrate that fits the byte budget', () => {
    // 10 MB over 20s output: <= 10MB*8/20 bits/sec, minus overhead
    const b = mp4BitrateFor(10 * 1024 * 1024, 20);
    expect(b).toBeLessThanOrEqual((10 * 1024 * 1024 * 8) / 20);
    expect(b).toBeGreaterThan(((10 * 1024 * 1024 * 8) / 20) * 0.9);
    expect(mp4BitrateFor(10, 0)).toBeNull();
  });
});

// Simulate a full search against a monotonic size model: size = axis * scale.
function runSearch(format, base, targetBytes, bytesForAxis) {
  let state = initSearch(format, base);
  const probes = [];
  for (;;) {
    const axis = nextProbe(state);
    if (axis == null) break;
    probes.push(axis);
    state = recordResult(state, axis, bytesForAxis(axis), targetBytes, `job-${axis}`);
  }
  return { state, probes };
}

describe('target-size search', () => {
  it('finishes in one attempt when max quality already fits', () => {
    const { state, probes } = runSearch('webp', { quality: 75 }, 10_000_000, (a) => a * 1000);
    expect(probes).toEqual([95]);
    expect(state.best.axis).toBe(95);
  });

  it('converges to the highest quality under the target', () => {
    // size = axis * 100k; target 5 MB -> best fitting axis is 50 -> q50
    const { state, probes } = runSearch('webp', { quality: 75 }, 5_000_000, (a) => a * 100_000);
    expect(probes.length).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(state.best).not.toBeNull();
    expect(state.best.bytes).toBeLessThanOrEqual(5_000_000);
    expect(state.best.axis).toBe(50);
  });

  it('reports the smallest attempt when nothing fits', () => {
    const { state } = runSearch('webp', { quality: 75 }, 1, (a) => a * 1000);
    expect(state.best).toBeNull();
    expect(state.smallest).not.toBeNull();
    expect(state.smallest.axis).toBe(10); // it tried the floor
  });

  it('never exceeds the attempt budget', () => {
    const { probes } = runSearch('mp4', { crf: 28 }, 3_000_000, (a) => a * 99_999);
    expect(probes.length).toBeLessThanOrEqual(MAX_ATTEMPTS);
  });

  it('maps the axis to the right settings knob per format', () => {
    const webp = initSearch('webp', { quality: 75, width: 720 });
    expect(axisToSettings(webp, 40)).toMatchObject({ quality: 40, width: 720 });
    const mp4 = initSearch('mp4', { crf: 28 });
    expect(axisToSettings(mp4, 30)).toMatchObject({ crf: 28 }); // 58 - 30 = 28
    expect(describeAxis(mp4, 30)).toBe('crf28');
    const gif = initSearch('gif', { width: 720, bayerScale: 5 });
    expect(axisToSettings(gif, 400)).toMatchObject({ width: 400 });
    expect(gif.hi).toBe(720);
    expect(describeAxis(gif, 400)).toBe('400px');
  });

  it('searches width for gif, snapped to the step', () => {
    // size proportional to width^2-ish; target forces a mid width
    const { state } = runSearch('gif', { width: 720 }, 3_000_000, (w) => w * w * 10);
    expect(state.best).not.toBeNull();
    expect(state.best.axis % 40).toBe(0);
    expect(state.best.bytes).toBeLessThanOrEqual(3_000_000);
  });
});
