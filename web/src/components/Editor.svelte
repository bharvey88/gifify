<script>
  import { createEventDispatcher } from 'svelte';
  import { streamUrl } from '../lib/api.js';
  import { formatTime, fracToTime, moveStart, moveEnd, clipLength, clamp } from '../lib/trim.js';

  export let card;

  const dispatch = createEventDispatcher();

  let videoEl;
  let track;
  let currentTime = 0;
  let duration = 0;
  let looping = false;
  let dragging = null; // 'start' | 'end' | 'seek'

  $: duration = card.durationSec || duration || 0;
  $: start = card.startSec ?? 0;
  $: end = card.endSec ?? duration;
  $: startPct = duration ? (start / duration) * 100 : 0;
  $: endPct = duration ? (end / duration) * 100 : 100;
  $: playPct = duration ? (currentTime / duration) * 100 : 0;

  // When switching cards, reset transient player state.
  let lastCardId = null;
  $: if (card.id !== lastCardId) {
    lastCardId = card.id;
    looping = false;
    currentTime = 0;
  }

  function setTrim(newStart, newEnd) {
    dispatch('trim', { startSec: round1(newStart), endSec: round1(newEnd) });
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function trackFrac(e) {
    const rect = track.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
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
    if (!dragging || !duration) return;
    const t = fracToTime(trackFrac(e), duration);
    if (dragging === 'start') setTrim(moveStart(t, end, duration), end);
    else if (dragging === 'end') setTrim(start, moveEnd(t, start, duration));
    else if (dragging === 'seek' && videoEl) videoEl.currentTime = t;
  }

  function onPointerUp() {
    dragging = null;
  }

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
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    bind:this={videoEl}
    src={streamUrl(card.id)}
    controls
    playsinline
    on:timeupdate={onTimeUpdate}
    on:loadedmetadata={() => { if (!card.durationSec) duration = videoEl.duration; }}
  />

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
    <button on:click={setStartToPlayhead} title="Set clip start to current playback position">⇤ Start here</button>
    <button on:click={setEndToPlayhead} title="Set clip end to current playback position">End here ⇥</button>
    <button on:click={previewClip} class:active={looping}>{looping ? '◼ Stop loop' : '↻ Loop clip'}</button>
    <button on:click={resetTrim} disabled={start === 0 && end >= duration - 0.05}>Reset</button>
  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 10px; }
  video {
    width: 100%;
    max-height: 420px;
    background: #000;
    border-radius: 8px;
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
</style>
