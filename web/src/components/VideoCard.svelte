<script>
  import { createEventDispatcher } from 'svelte';
  import { formatTime, formatBytes } from '../lib/trim.js';
  import { streamUrl } from '../lib/api.js';

  export let card;
  export let selected = false;

  const dispatch = createEventDispatcher();

  $: latest = card.attempts?.[0];
</script>

<div
  class="card"
  class:selected
  class:failed={card.status === 'failed'}
  role="button"
  tabindex="0"
  on:click={() => dispatch('select')}
  on:keydown={(e) => e.key === 'Enter' && dispatch('select')}
>
  {#if card.status !== 'uploading'}
    <video class="thumb" src={streamUrl(card.id)} preload="metadata" muted />
  {:else}
    <div class="thumb placeholder">⏳</div>
  {/if}
  <div class="info">
    <div class="name" title={card.name}>{card.name}</div>
    <div class="status muted">
      {#if card.status === 'uploading'}uploading…
      {:else if card.status === 'queued'}queued
      {:else if card.status === 'converting'}converting {card.pct}%
      {:else if card.status === 'done'}done · {formatBytes(latest?.bytes)}
      {:else if card.status === 'failed'}<span class="err">failed</span>
      {:else}{formatTime(card.durationSec)}{/if}
    </div>
    {#if card.status === 'converting'}
      <div class="bar"><div class="fill" style="width: {card.pct}%" /></div>
    {/if}
  </div>
  <button class="x" title="Remove" on:click|stopPropagation={() => dispatch('remove')}>✕</button>
</div>

<style>
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    min-width: 230px;
    max-width: 280px;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
  }
  .card.selected { border-color: var(--accent); }
  .card.failed { border-color: var(--danger); }
  .thumb {
    width: 64px;
    height: 40px;
    object-fit: cover;
    border-radius: 6px;
    background: #000;
    pointer-events: none;
  }
  .placeholder { display: grid; place-items: center; }
  .info { min-width: 0; flex: 1; }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.9rem;
  }
  .status { font-size: 0.8rem; }
  .err { color: var(--danger); }
  .bar {
    height: 4px;
    background: var(--bg);
    border-radius: 2px;
    margin-top: 4px;
    overflow: hidden;
  }
  .fill { height: 100%; background: var(--accent); transition: width 0.2s; }
  .x {
    padding: 0 6px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .x:hover { color: var(--danger); }
</style>
