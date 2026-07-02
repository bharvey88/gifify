import { describe, it, expect } from 'vitest';
import { videoDisplayRect, displayToSource, sourceToDisplay, cornersToBox, moveBox } from './crop.js';

describe('videoDisplayRect', () => {
  it('letterboxes top/bottom when element is wider than the video aspect', () => {
    // 1000x420 element, 1280x720 video -> height-limited: scale 420/720
    const r = videoDisplayRect(1000, 420, 1280, 720);
    expect(r.scale).toBeCloseTo(420 / 720);
    expect(r.offsetX).toBeCloseTo((1000 - 1280 * (420 / 720)) / 2);
    expect(r.offsetY).toBe(0);
  });

  it('fills exactly when aspect matches', () => {
    const r = videoDisplayRect(640, 360, 1280, 720);
    expect(r.scale).toBe(0.5);
    expect(r.offsetX).toBe(0);
    expect(r.offsetY).toBe(0);
  });

  it('degrades safely with missing dimensions', () => {
    expect(videoDisplayRect(0, 0, 1280, 720)).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });
});

describe('coordinate round-trip', () => {
  it('display -> source -> display is identity', () => {
    const rect = videoDisplayRect(1000, 420, 1280, 720);
    const src = displayToSource(300, 100, rect);
    const back = sourceToDisplay(src.x, src.y, rect);
    expect(back.px).toBeCloseTo(300);
    expect(back.py).toBeCloseTo(100);
  });
});

describe('cornersToBox', () => {
  it('normalizes corners dragged in any direction', () => {
    expect(cornersToBox(500, 400, 100, 50, 1280, 720)).toEqual({ x: 100, y: 50, width: 400, height: 350 });
  });

  it('clamps to the video bounds', () => {
    expect(cornersToBox(-50, -50, 5000, 5000, 1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('rejects boxes below the 16px minimum', () => {
    expect(cornersToBox(10, 10, 20, 300, 1280, 720)).toBeNull();
    expect(cornersToBox(10, 10, 300, 20, 1280, 720)).toBeNull();
  });
});

describe('moveBox', () => {
  const box = { x: 100, y: 100, width: 200, height: 100 };
  it('moves freely inside the frame', () => {
    expect(moveBox(box, 50, -20, 1280, 720)).toEqual({ x: 150, y: 80, width: 200, height: 100 });
  });
  it('stops at the edges', () => {
    expect(moveBox(box, -500, 0, 1280, 720).x).toBe(0);
    expect(moveBox(box, 5000, 5000, 1280, 720)).toEqual({ x: 1080, y: 620, width: 200, height: 100 });
  });
});
