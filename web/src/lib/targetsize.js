// Target-size mode: binary-search the format's dominant size knob to find
// the highest quality that fits under a byte budget. Pure state machine —
// the caller runs the actual conversions.
//
// The search axis is normalized so HIGHER value = higher quality = bigger
// file, regardless of format:
//   webp: axis = quality (10..95, step 5)
//   mp4:  axis = 58 - crf (crf 40..18 -> axis 18..40, step 1)
//   gif:  axis = width (320..current width, step 40) — gif's quality knobs
//         barely move file size; width is the honest lever.

export const MAX_ATTEMPTS = 6;

function axisSpec(format, baseSettings) {
  if (format === 'webp') return { lo: 10, hi: 95, step: 5 };
  if (format === 'mp4') return { lo: 18, hi: 40, step: 1 };
  const width = Number(baseSettings.width) || 720;
  return { lo: 320, hi: Math.max(width, 320), step: 40 };
}

export function axisToSettings(state, axis) {
  const base = state.base;
  if (state.format === 'webp') return { ...base, quality: axis };
  if (state.format === 'mp4') return { ...base, crf: 58 - axis };
  return { ...base, width: axis };
}

export function describeAxis(state, axis) {
  if (state.format === 'webp') return `q${axis}`;
  if (state.format === 'mp4') return `crf${58 - axis}`;
  return `${axis}px`;
}

export function initSearch(format, baseSettings) {
  const spec = axisSpec(format, baseSettings);
  return {
    format,
    base: { ...baseSettings },
    ...spec,
    attempts: 0,
    best: null,     // {axis, bytes, jobId} of the highest-quality fit so far
    smallest: null, // smallest result seen, for the "nothing fits" report
    done: false,
  };
}

// Next axis value to try, or null when the search is finished.
export function nextProbe(state) {
  if (state.done || state.attempts >= MAX_ATTEMPTS || state.lo > state.hi) return null;
  // First probe is max quality: if it fits, we're done in one conversion.
  if (state.attempts === 0) return state.hi;
  const mid = state.lo + Math.floor((state.hi - state.lo) / state.step / 2) * state.step;
  return mid;
}

// Fold a conversion result into the search. Returns the new state.
export function recordResult(state, axis, bytes, targetBytes, jobId) {
  const next = { ...state, attempts: state.attempts + 1 };
  if (!next.smallest || bytes < next.smallest.bytes) next.smallest = { axis, bytes, jobId };
  if (bytes <= targetBytes) {
    if (!next.best || axis > next.best.axis) next.best = { axis, bytes, jobId };
    next.lo = axis + next.step; // fits: look for something even better
  } else {
    next.hi = axis - next.step; // too big: come down
  }
  if (next.lo > next.hi || next.attempts >= MAX_ATTEMPTS) next.done = true;
  // Highest possible quality already fits — no point searching further.
  if (next.best && next.best.axis >= state.hi && state.attempts === 0) next.done = true;
  return next;
}
