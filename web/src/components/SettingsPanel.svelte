<script>
  import { createEventDispatcher } from 'svelte';

  export let card;
  export let presets = {};
  export let busy = false;

  const dispatch = createEventDispatcher();

  const PRESET_LABELS = {
    'wiki-webp': 'Wiki WebP',
    'wiki-gif': 'Wiki GIF',
    'tiny-mp4': 'Tiny MP4',
  };

  let showAdvanced = false;

  $: s = card.settings;

  function set(key, value) {
    dispatch('change', { [key]: value });
  }

  function activePreset() {
    for (const [key, p] of Object.entries(presets)) {
      if (Object.entries(p).every(([k, v]) => s[k] === v)) return key;
    }
    return null;
  }
  $: active = presets && s && activePreset(s);
</script>

<div class="panel">
  <div class="presets">
    {#each Object.keys(presets) as key}
      <button class:primary={active === key} on:click={() => dispatch('preset', key)}>
        {PRESET_LABELS[key] ?? key}
      </button>
    {/each}
    <button class="toggle" on:click={() => (showAdvanced = !showAdvanced)}>
      {showAdvanced ? '▾' : '▸'} Advanced
    </button>
  </div>

  {#if showAdvanced}
    <div class="advanced">
      <label>
        Format
        <div class="seg">
          {#each ['webp', 'gif', 'mp4'] as f}
            <button class:primary={s.format === f} on:click={() => set('format', f)}>{f}</button>
          {/each}
        </div>
      </label>
      <label>
        Width <span class="mono">{s.width}px</span>
        <input type="range" min="240" max="1920" step="40" value={s.width}
          on:input={(e) => set('width', Number(e.target.value))} />
      </label>
      <label>
        Speed <span class="mono">{s.speed ?? 1}×</span>
        <div class="seg">
          {#each [1, 1.25, 1.5, 2, 3] as v}
            <button class:primary={(s.speed ?? 1) === v} on:click={() => set('speed', v)}>{v}×</button>
          {/each}
        </div>
      </label>
      <label>
        FPS <span class="mono">{s.fps}</span>
        <input type="range" min="5" max="60" step="1" value={s.fps}
          on:input={(e) => set('fps', Number(e.target.value))} />
      </label>
      {#if s.format === 'webp'}
        <label>
          Quality <span class="mono">{s.quality}</span>
          <input type="range" min="0" max="100" step="5" value={s.quality}
            on:input={(e) => set('quality', Number(e.target.value))} />
        </label>
      {:else if s.format === 'gif'}
        <label>
          Dither (bayer scale, lower = smoother, bigger) <span class="mono">{s.bayerScale}</span>
          <input type="range" min="0" max="5" step="1" value={s.bayerScale}
            on:input={(e) => set('bayerScale', Number(e.target.value))} />
        </label>
      {:else}
        <label>
          CRF (lower = higher quality, bigger) <span class="mono">{s.crf}</span>
          <input type="range" min="18" max="32" step="1" value={s.crf}
            on:input={(e) => set('crf', Number(e.target.value))} />
        </label>
      {/if}
    </div>
  {/if}

  <button class="primary convert" disabled={busy} on:click={() => dispatch('convert')}>
    {busy ? 'Converting…' : `Convert to ${s.format.toUpperCase()}`}
  </button>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 12px; }
  .presets { display: flex; gap: 8px; flex-wrap: wrap; }
  .toggle { border: none; background: none; color: var(--muted); }
  .advanced { display: flex; flex-direction: column; gap: 10px; }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  label .mono { color: var(--text); }
  .seg { display: flex; gap: 6px; }
  .convert { padding: 10px; font-size: 1rem; }
</style>
