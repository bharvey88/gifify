import { describe, it, expect } from 'vitest';
import {
  clamp, formatTime, fracToTime, moveStart, moveEnd, clipLength, formatBytes, MIN_CLIP_SEC,
} from './trim.js';

describe('formatTime', () => {
  it('formats minutes, seconds, and tenths', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(19)).toBe('0:19.0');
    expect(formatTime(83.25)).toBe('1:23.2');
    expect(formatTime(600)).toBe('10:00.0');
  });
  it('handles non-finite input', () => {
    expect(formatTime(NaN)).toBe('-:--');
    expect(formatTime(undefined)).toBe('-:--');
  });
});

describe('fracToTime', () => {
  it('maps track fraction to seconds, clamped', () => {
    expect(fracToTime(0.5, 60)).toBe(30);
    expect(fracToTime(-0.2, 60)).toBe(0);
    expect(fracToTime(1.5, 60)).toBe(60);
  });
});

describe('trim handle movement', () => {
  it('start handle cannot cross the end handle', () => {
    expect(moveStart(25, 20, 60)).toBeCloseTo(20 - MIN_CLIP_SEC);
    expect(moveStart(-5, 20, 60)).toBe(0);
    expect(moveStart(10, 20, 60)).toBe(10);
  });
  it('end handle cannot cross the start handle or the video end', () => {
    expect(moveEnd(5, 10, 60)).toBeCloseTo(10 + MIN_CLIP_SEC);
    expect(moveEnd(75, 10, 60)).toBe(60);
    expect(moveEnd(30, 10, 60)).toBe(30);
  });
});

describe('clipLength', () => {
  it('returns end - start, floored at 0', () => {
    expect(clipLength(3, 19)).toBe(16);
    expect(clipLength(19, 3)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.50 MB');
  });
});
