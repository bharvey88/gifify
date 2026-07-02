// Pure math for the crop overlay: mapping between the <video> element's
// display box (which letterboxes with object-fit: contain) and source pixels.

// Where the video content actually renders inside the element box.
export function videoDisplayRect(clientW, clientH, videoW, videoH) {
  if (!clientW || !clientH || !videoW || !videoH) {
    return { offsetX: 0, offsetY: 0, scale: 1 };
  }
  const scale = Math.min(clientW / videoW, clientH / videoH);
  return {
    offsetX: (clientW - videoW * scale) / 2,
    offsetY: (clientH - videoH * scale) / 2,
    scale,
  };
}

// Element-relative display point -> source pixel point (unclamped).
export function displayToSource(px, py, rect) {
  return { x: (px - rect.offsetX) / rect.scale, y: (py - rect.offsetY) / rect.scale };
}

// Source pixel point -> element-relative display point.
export function sourceToDisplay(x, y, rect) {
  return { px: x * rect.scale + rect.offsetX, py: y * rect.scale + rect.offsetY };
}

// Two source-space corners -> a normalized {x, y, width, height} box clamped
// to the video bounds. Returns null if the result is too small to be a
// meaningful crop (matches the server's 16px minimum).
export function cornersToBox(x1, y1, x2, y2, videoW, videoH) {
  const left = Math.max(Math.min(x1, x2), 0);
  const top = Math.max(Math.min(y1, y2), 0);
  const right = Math.min(Math.max(x1, x2), videoW);
  const bottom = Math.min(Math.max(y1, y2), videoH);
  const box = {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
  if (box.width < 16 || box.height < 16) return null;
  return box;
}

// Move an existing box by a source-space delta, keeping it inside the video.
export function moveBox(box, dx, dy, videoW, videoH) {
  const x = Math.round(Math.min(Math.max(box.x + dx, 0), videoW - box.width));
  const y = Math.round(Math.min(Math.max(box.y + dy, 0), videoH - box.height));
  return { ...box, x, y };
}
