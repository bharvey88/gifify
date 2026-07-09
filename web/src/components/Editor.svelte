<script>
  import { createEventDispatcher } from 'svelte';
  import { streamUrl } from '../lib/api.js';
  import { formatTime, fracToTime, moveStart, moveEnd, clipLength, clamp } from '../lib/trim.js';
  import { videoDisplayRect, displayToSource, sourceToDisplay, cornersToBox, moveBox } from '../lib/crop.js';

  export let card;

  const dispatch = createEventDispatcher();

  let videoEl;
  let track;
  let wrap;
  let wrapW = 0;
  let wrapH = 0;
  let currentTime = 0;
  let duration = 0;
  let looping = false;
  let dragging = null; // 'start' | 'end' | 'seek'
  let cropMode = false;
  let cropDrag = null; // {type:'draw', ax, ay} | {type:'move', sx, sy, orig}
  let draftCrop = null;

  $: duration = card.durationSec || duration || 0;
  $: start = card.startSec ?? 0;
  $: end = card.endSec ?? duration;
  $: startPct = duration ? (start / duration) * 100 : 0;
  $: endPct = duration ? (end / duration) * 100 : 100;
  $: playPct = duration ? (currentTime / duration) * 100 : 0;

  $: srcW = card.width || videoEl?.videoWidth || 0;
  $: srcH = card.height || videoEl?.videoHeight || 0;
  $: rect = videoDisplayRect(wrapW, wrapH, srcW, srcH);
  $: activeCrop = draftCrop ?? card.crop ?? null;
  $: cropStyle = activeCrop ? boxStyle(activeCrop, rect) : '';

  function boxStyle(box, r) {
    const tl = sourceToDisplay(box.x, box.y, r);
    return `left:${tl.px}px; top:${tl.py}px; width:${box.width * r.scale}px; height:${box.height * r.scale}px;`;
  }

  // When switching cards, reset transient player state.
  let lastCardId = null;
  $: if (card.id !== lastCardId) {
    lastCardId = card.id;
    looping = false;
    cropMode = false;
    cropDrag = null;
    draftCrop = null;
    currentTime = 0;
  }

  function setTrim(newStart, newEnd) {
    dispatch('trim', { startSec: round1(newStart), endSec: round1(newEnd) });
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  // --- trim scrubber ---

  function trackFrac(e) {
    const r = track.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  }

  function onPointerDown(which) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = which;
      e.target.setPointerCapture?.(e.pointerId);
    };
  }

  function onTrackDown(e) {
    dragging = 'seek';
    onPointerMove(e);
  }

  function onPointerMove(e) {
    if (cropDrag) return onCropMove(e);
    if (!dragging || !duration) return;
    const t = fracToTime(trackFrac(e), duration);
    if (dragging === 'start') setTrim(moveStart(t, end, duration), end);
    else if (dragging === 'end') setTrim(start, moveEnd(t, start, duration));
    else if (dragging === 'seek' && videoEl) videoEl.currentTime = t;
  }

  function onPointerUp() {
    dragging = null;
    if (cropDrag) {
      if (draftCrop) dispatch('crop', { crop: draftCrop });
      cropDrag = null;
      draftCrop = null;
    }
  }

  // --- crop overlay ---

  function overlayPoint(e) {
    const r = wrap.getBoundingClientRect();
    return displayToSource(e.clientX - r.left, e.clientY - r.top, rect);
  }

  function onOverlayDown(e) {
    e.preventDefault();
    const p = overlayPoint(e);
    const box = card.crop;
    if (box && p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height) {
      cropDrag = { type: 'move', sx: p.x, sy: p.y, orig: box };
    } else {
      cropDrag = { type: 'draw', ax: clamp(p.x, 0, srcW), ay: clamp(p.y, 0, srcH) };
      draftCrop = null;
    }
  }

  function onCropMove(e) {
    const p = overlayPoint(e);
    if (cropDrag.type === 'draw') {
      draftCrop = cornersToBox(cropDrag.ax, cropDrag.ay, p.x, p.y, srcW, srcH);
    } else {
      draftCrop = moveBox(cropDrag.orig, p.x - cropDrag.sx, p.y - cropDrag.sy, srcW, srcH);
    }
  }

  function clearCrop() {
    dispatch('crop', { crop: null });
    draftCrop = null;
  }

  // --- playback ---

  function onTimeUpdate() {
    currentTime = videoEl?.currentTime ?? 0;
    if (looping && currentTime >= end - 0.03) {
      videoEl.currentTime = start;
      videoEl.play();
    }
  }

  function previewClip() {
    if (!videoEl) return;
    looping = !looping;
    if (looping) {
      videoEl.currentTime = start;
      videoEl.play();
    } else {
      videoEl.pause();
    }
  }

  function setStartToPlayhead() {
    setTrim(moveStart(currentTime, end, duration), end);
  }

  function setEndToPlayhead() {
    setTrim(start, moveEnd(currentTime, start, duration));
  }

  function resetTrim() {
    setTrim(0, duration);
  }
</script>

<svelte:window on:pointermove={onPointerMove} on:pointerup={onPointerUp} />

<div class="panel editor">
  <div
    class="video-wrap"
    bind:this={wrap}
    bind:clientWidth={wrapW}
    bind:clientHeight={wrapH}
  >
    <!-- svelte-ignore a11y-media-has-caption -->
    <video
      bind:this={videoEl}
      src={streamUrl(card.id)}
      controls={!cropMode}
      playsinline
      on:timeupdate={onTimeUpdate}
      on:loadedmetadata={() => { if (!card.durationSec) duration = videoEl.duration; }}
    />
    {#if cropMode}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="crop-overlay" on:pointerdown={onOverlayDown}>
        {#if activeCrop}
          <div class="crop-box" style={cropStyle}>
            <span class="crop-dims">{activeCrop.width}×{activeCrop.height}</span>
          </div>
        {:else}
          <div class="crop-hint">Drag to draw a crop box</div>
        {/if}
      </div>
    {:else if card.crop}
      <div class="crop-overlay passive">
        <div class="crop-box" style={boxStyle(card.crop, rect)} />
      </div>
    {/if}
  </div>

  <div
    class="track"
    bind:this={track}
    on:pointerdown={onTrackDown}
  >
    <div class="range" style="left: {startPct}%; width: {endPct - startPct}%" />
    <div class="playhead" style="left: {playPct}%" />
    <div
      class="handle start"
      style="left: {startPct}%"
      title="Drag to set start"
      on:pointerdown={onPointerDown('start')}
    />
    <div
      class="handle end"
      style="left: {endPct}%"
      title="Drag to set end"
      on:pointerdown={onPointerDown('end')}
    />
  </div>

  <div class="controls">
    <span class="mono readout">
      {formatTime(start)} – {formatTime(end)}
      <span class="muted">({formatTime(clipLength(start, end))} clip)</span>
    </span>
    <div class="spacer" />
    <button on:click={setStartToPlayhead} title="Start the clip at the current playback position">
      ⇤ Clip start → <span class="mono">{formatTime(currentTime)}</span>
    </button>
    <button on:click={setEndToPlayhead} title="End the clip at the current playback position">
      Clip end → <span class="mono">{formatTime(currentTime)}</span> ⇥
    </button>
    <button on:click={previewClip} class:active={looping}>{looping ? '◼ Stop loop' : '↻ Loop clip'}</button>
    <button on:click={() => (cropMode = !cropMode)} class:active={cropMode} title="Crop the video frame">
      {cropMode ? '✓ Done cropping' : '⛶ Crop'}
    </button>
    {#if card.crop}
      <button on:click={clearCrop}>Clear crop ({card.crop.width}×{card.crop.height})</button>
    {/if}
    <button
      on:click={() => dispatch('reverse', !card.settings.reverse)}
      class:active={card.settings.reverse}
      title="Play the clip backwards"
    >
      ⏪ Reverse
    </button>
    <button on:click={resetTrim} disabled={start === 0 && end >= duration - 0.05}>Reset</button>
  </div>
  <div class="muted hint">
    Trim by dragging the blue handles, or pause the video where you want the clip to begin/end and use the buttons above.
    {#if cropMode}Drag on the video to draw a crop box; drag inside the box to move it.{/if}
  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 10px; }
  .video-wrap { position: relative; }
  video {
    width: 100%;
    max-height: 420px;
    background: #000;
    border-radius: 8px;
    display: block;
  }
  .crop-overlay {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
    overflow: hidden; /* contain the crop-box's dimming box-shadow */
    border-radius: 8px;
  }
  .crop-overlay.passive { pointer-events: none; }
  .crop-box {
    position: absolute;
    border: 2px solid var(--accent-2);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    cursor: move;
  }
  .crop-dims {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 0.75rem;
    color: var(--accent-2);
    text-shadow: 0 0 4px #000;
  }
  .crop-hint {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 0.85rem;
    pointer-events: none;
  }
  .track {
    position: relative;
    height: 26px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    touch-action: none;
    margin: 0 8px;
  }
  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(79, 156, 249, 0.25);
    border-left: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
    pointer-events: none;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent-2);
    pointer-events: none;
    transform: translateX(-1px);
  }
  .handle {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 14px;
    background: var(--accent);
    border-radius: 4px;
    cursor: ew-resize;
    transform: translateX(-7px);
    touch-action: none;
  }
  .handle:hover { filter: brightness(1.2); }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .spacer { flex: 1; }
  .readout { font-size: 0.95rem; }
  button.active { border-color: var(--accent-2); color: var(--accent-2); }
  .hint { font-size: 0.8rem; }
</style>
