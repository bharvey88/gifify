<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let compact = false;

  let dragging = false;
  let input;

  const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;

  function pickVideos(fileList) {
    const files = [...fileList].filter((f) => VIDEO_EXT.test(f.name) || f.type.startsWith('video/'));
    if (files.length) dispatch('files', files);
  }

  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    pickVideos(e.dataTransfer.files);
  }
</script>

<svelte:window
  on:dragover|preventDefault={() => (dragging = true)}
  on:dragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  on:drop={onDrop}
/>

<div
  class="zone"
  class:compact
  class:dragging
  role="button"
  tabindex="0"
  on:click={() => input.click()}
  on:keydown={(e) => e.key === 'Enter' && input.click()}
>
  {#if compact}
    <span>➕ Drop more videos anywhere, or click to browse</span>
  {:else}
    <div class="big">🎬</div>
    <div>Drop videos here (mp4, mov, mkv, webm, avi, m4v)</div>
    <div class="muted">or click to browse</div>
  {/if}
</div>

<input
  bind:this={input}
  type="file"
  accept="video/*,.mkv,.m4v"
  multiple
  hidden
  on:change={(e) => { pickVideos(e.target.files); e.target.value = ''; }}
/>

<style>
  .zone {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 40px 20px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .zone.compact { padding: 10px; font-size: 0.9rem; color: var(--muted); }
  .zone:hover, .zone.dragging {
    border-color: var(--accent);
    background: rgba(79, 156, 249, 0.06);
  }
  .big { font-size: 2.2rem; }
</style>
