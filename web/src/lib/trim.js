// Pure trim/time math for the scrubber. Unit-tested.

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// 83.25 -> "1:23.3"
export function formatTime(sec) {
  if (!Number.isFinite(sec)) return '-:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const whole = Math.floor(s);
  const tenth = Math.floor((s - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}.${tenth}`;
}

// Fraction of track width (0..1) -> seconds.
export function fracToTime(frac, durationSec) {
  return clamp(frac, 0, 1) * durationSec;
}

export const MIN_CLIP_SEC = 0.2;

// Dragging the start handle: never past end - MIN_CLIP_SEC, never below 0.
export function moveStart(newStart, end, durationSec) {
  return clamp(newStart, 0, Math.max(end - MIN_CLIP_SEC, 0));
}

// Dragging the end handle: never before start + MIN_CLIP_SEC, never past duration.
export function moveEnd(newEnd, start, durationSec) {
  return clamp(newEnd, Math.min(start + MIN_CLIP_SEC, durationSec), durationSec);
}

export function clipLength(start, end) {
  return Math.max(end - start, 0);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
