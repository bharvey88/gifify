<script>
  import { formatBytes } from '../lib/trim.js';
  import { resultUrl, downloadUrl } from '../lib/api.js';

  export let card;

  $: attempts = card.attempts ?? [];
  $: latest = attempts[0];
  let shownJobId = null;
  $: shown = attempts.find((a) => a.jobId === shownJobId) ?? latest;
</script>

<div class="panel result">
  {#if card.status === 'converting' || card.status === 'queued'}
    <div class="progress">
      {#if card.status === 'queued'}
        <div>Waiting in queue…</div>
        <div class="bar"><div class="fill indeterminate" /></div>
      {:else if card.stage === 'palette'}
        <div>Analyzing colors for the GIF palette…</div>
        <div class="bar"><div class="fill indeterminate" /></div>
      {:else}
        <div>Converting… <span class="mono">{card.pct}%</span></div>
        <div class="bar"><div class="fill" style="width: {card.pct}%" /></div>
      {/if}
    </div>
  {:else if card.status === 'failed' && card.error}
    <details class="error" open>
      <summary>Conversion failed</summary>
      <pre>{card.error}</pre>
    </details>
  {/if}

  {#if shown}
    <div class="preview">
      {#if shown.format === 'mp4'}
        <!-- svelte-ignore a11y-media-has-caption -->
        <video src={resultUrl(shown.jobId)} autoplay loop muted playsinline />
      {:else}
        <img src={resultUrl(shown.jobId)} alt="Converted result" />
      {/if}
    </div>
    <div class="meta">
      <span class="size mono">{formatBytes(shown.bytes)}</span>
      <span class="muted">{shown.summary}</span>
      <div class="spacer" />
      <a class="btn" href={downloadUrl(shown.jobId)}>⬇ Download</a>
    </div>
    {#if shown.saveError}
      <div class="save-err">⚠ {shown.saveError}</div>
    {:else if shown.outPath}
      <div class="muted saved">✓ saved to <span class="mono">{shown.outPath}</span></div>
    {/if}

    {#if attempts.length > 1}
      <div class="history">
        <div class="muted">Attempts</div>
        {#each attempts as a (a.jobId)}
          <button
            class="attempt"
            class:current={a.jobId === shown.jobId}
            on:click={() => (shownJobId = a.jobId)}
          >
            <span>{a.summary}</span>
            <span class="mono">{formatBytes(a.bytes)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {:else if card.status === 'ready'}
    <div class="empty muted">Trim the clip, pick a preset, hit Convert — the result shows here.</div>
  {/if}
</div>

<style>
  .result { display: flex; flex-direction: column; gap: 10px; min-height: 200px; }
  .preview img, .preview video {
    max-width: 100%;
    max-height: 320px;
    border-radius: 8px;
    background: #000;
    display: block;
    margin: 0 auto;
  }
  .meta { display: flex; align-items: center; gap: 10px; }
  .size { font-size: 1.3rem; font-weight: 600; color: var(--accent-2); }
  .spacer { flex: 1; }
  .btn {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 14px;
    color: var(--text);
    text-decoration: none;
  }
  .btn:hover { border-color: var(--accent); }
  .saved { font-size: 0.8rem; word-break: break-all; }
  .save-err { color: var(--danger); font-size: 0.85rem; }
  .progress .bar {
    height: 8px;
    background: var(--bg);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 6px;
  }
  .progress .fill { height: 100%; background: var(--accent); transition: width 0.2s; }
  .progress .fill.indeterminate {
    width: 30%;
    animation: slide 1.2s ease-in-out infinite alternate;
  }
  @keyframes slide {
    from { margin-left: 0; }
    to { margin-left: 70%; }
  }
  .error { color: var(--danger); }
  .error pre {
    white-space: pre-wrap;
    font-size: 0.75rem;
    max-height: 160px;
    overflow: auto;
  }
  .history { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
  .attempt {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 10px;
    text-align: left;
  }
  .attempt.current { border-color: var(--accent); }
  .empty { display: grid; place-items: center; flex: 1; text-align: center; }
</style>
