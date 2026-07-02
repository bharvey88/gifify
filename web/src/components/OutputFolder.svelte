<script>
  import { createEventDispatcher } from 'svelte';
  import { putSettings } from '../lib/api.js';

  export let outputDir = '';

  const dispatch = createEventDispatcher();

  let open = false;
  let value = '';
  let error = '';
  let saving = false;

  $: if (!open) value = outputDir;

  async function save() {
    saving = true;
    error = '';
    try {
      const saved = await putSettings({ outputDir: value });
      dispatch('saved', saved);
      open = false;
    } catch (err) {
      error = err.message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="wrap">
  <button title="Output folder settings" on:click={() => (open = !open)}>
    ⚙ <span class="mono dir">{outputDir}</span>
  </button>
  {#if open}
    <div class="pop panel">
      <label for="outdir">Save converted files to</label>
      <input id="outdir" type="text" bind:value spellcheck="false" />
      {#if error}<div class="err">{error}</div>{/if}
      <div class="row">
        <button on:click={() => (open = false)}>Cancel</button>
        <button class="primary" disabled={saving} on:click={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .dir {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
    vertical-align: bottom;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    width: 380px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  }
  label { font-size: 0.85rem; color: var(--muted); }
  input { width: 100%; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .err { color: var(--danger); font-size: 0.8rem; }
</style>
