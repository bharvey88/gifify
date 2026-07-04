<script>
  import { onMount } from 'svelte';
  import DropZone from './components/DropZone.svelte';
  import VideoCard from './components/VideoCard.svelte';
  import Editor from './components/Editor.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ResultPanel from './components/ResultPanel.svelte';
  import SetupScreen from './components/SetupScreen.svelte';
  import OutputFolder from './components/OutputFolder.svelte';
  import * as api from './lib/api.js';
  import * as ts from './lib/targetsize.js';

  let health = null;
  let presets = {};
  let serverSettings = { outputDir: '' };
  let cards = [];
  let selectedId = null;
  let globalError = '';

  $: selected = cards.find((c) => c.id === selectedId) || null;

  onMount(async () => {
    try {
      let existing;
      [health, presets, serverSettings, existing] = await Promise.all([
        api.getHealth(),
        api.getPresets(),
        api.getSettings(),
        api.listVideos(),
      ]);
      // Adopt videos already on the server (ShareX uploads, page reloads).
      cards = existing.map((meta) => ({
        ...meta,
        status: 'ready',
        pct: 0,
        settings: defaultSettings(),
        attempts: [],
        startSec: 0,
        endSec: meta.durationSec ?? null,
      }));
      const requested = new URLSearchParams(location.search).get('video');
      selectedId = cards.find((c) => c.id === requested)?.id ?? cards[0]?.id ?? null;
      if (requested) history.replaceState(null, '', '/');
    } catch (err) {
      globalError = `Cannot reach the gifify server: ${err.message}`;
    }
  });

  function defaultSettings() {
    return { format: 'webp', fps: 24, width: 720, quality: 75, bayerScale: 5, crf: 28, speed: 1 };
  }

  async function addFiles(files) {
    for (const file of files) {
      const temp = {
        id: `uploading-${Math.random()}`,
        name: file.name,
        status: 'uploading',
        pct: 0,
        settings: defaultSettings(),
        attempts: [],
      };
      cards = [...cards, temp];
      try {
        const meta = await api.uploadVideo(file);
        const card = {
          ...temp,
          ...meta,
          status: 'ready',
          startSec: 0,
          endSec: meta.durationSec ?? null,
        };
        cards = cards.map((c) => (c === temp ? card : c));
        if (!selectedId || !cards.some((c) => c.id === selectedId && c.status !== 'uploading')) {
          selectedId = card.id;
        }
      } catch (err) {
        cards = cards.map((c) => (c === temp ? { ...temp, status: 'failed', error: err.message } : c));
      }
    }
  }

  async function removeCard(card) {
    cards = cards.filter((c) => c.id !== card.id);
    if (selectedId === card.id) selectedId = cards.find((c) => c.status !== 'uploading')?.id ?? null;
    if (!card.id.startsWith('uploading-')) {
      api.deleteVideo(card.id).catch(() => {});
    }
  }

  function patchCard(id, patch) {
    cards = cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  function applyPreset(card, key) {
    const preset = presets[key];
    if (!preset) return;
    patchCard(card.id, { settings: { ...card.settings, ...preset } });
  }

  // Convert with explicit settings; resolves with the finished attempt.
  async function convertWith(card, settings) {
    patchCard(card.id, { status: 'queued', pct: 0, error: null });
    const { jobId } = await api.startConvert({
      videoId: card.id,
      ...settings,
      startSec: card.startSec,
      endSec: card.endSec,
      crop: card.crop ?? null,
    });
    patchCard(card.id, { currentJobId: jobId });
    return new Promise((resolve, reject) => {
      api.watchJob(jobId, (evt) => {
        if (evt.status === 'running') {
          patchCard(card.id, { status: 'converting', stage: evt.stage ?? 'encode', pct: evt.pct ?? 0 });
        } else if (evt.status === 'done') {
          const current = cards.find((c) => c.id === card.id);
          const attempt = {
            jobId,
            bytes: evt.bytes,
            format: settings.format,
            summary: summarize(settings, card.crop),
            outPath: evt.outPath,
            saveError: evt.saveError || null,
          };
          patchCard(card.id, {
            status: 'done',
            pct: 100,
            attempts: [attempt, ...(current?.attempts ?? [])],
          });
          resolve(attempt);
        } else if (evt.status === 'failed') {
          patchCard(card.id, { status: 'failed', error: evt.error });
          reject(new Error(evt.error));
        }
      });
    });
  }

  async function convert(card) {
    if (!card || ['uploading', 'converting', 'queued'].includes(card.status)) return;
    patchCard(card.id, { fitNote: null });
    try {
      await convertWith(card, card.settings);
    } catch (err) {
      patchCard(card.id, { status: 'failed', error: err.message });
    }
  }

  // Target-size mode: binary-search the format's size knob until the result
  // fits under targetMB, keeping the highest quality that does.
  async function autoFit(card, targetMB) {
    if (!card || ['uploading', 'converting', 'queued'].includes(card.status)) return;
    const targetBytes = targetMB * 1024 * 1024;
    let state = ts.initSearch(card.settings.format, card.settings);
    try {
      for (;;) {
        const axis = ts.nextProbe(state);
        if (axis == null) break;
        patchCard(card.id, {
          fitNote: `Fitting under ${targetMB} MB — attempt ${state.attempts + 1}/${ts.MAX_ATTEMPTS}: trying ${ts.describeAxis(state, axis)}…`,
        });
        const attempt = await convertWith(card, ts.axisToSettings(state, axis));
        state = ts.recordResult(state, axis, attempt.bytes, targetBytes, attempt.jobId);
      }
    } catch (err) {
      patchCard(card.id, { fitNote: `Auto-fit stopped: ${err.message}` });
      return;
    }
    if (state.best) {
      patchCard(card.id, {
        settings: ts.axisToSettings(state, state.best.axis),
        fitNote: `✓ Fits: ${(state.best.bytes / 1024 / 1024).toFixed(2)} MB at ${ts.describeAxis(state, state.best.axis)} (best of ${state.attempts} attempts, in history)`,
      });
    } else {
      patchCard(card.id, {
        fitNote: `Couldn't get under ${targetMB} MB — smallest was ${(state.smallest.bytes / 1024 / 1024).toFixed(2)} MB at ${ts.describeAxis(state, state.smallest.axis)}. Try a shorter trim, lower fps, or a smaller width.`,
      });
    }
  }

  function summarize(s, crop) {
    const q = s.format === 'webp' ? `q${s.quality}` : s.format === 'gif' ? `bayer${s.bayerScale}` : `crf${s.crf}`;
    const extras = [
      s.speed && s.speed !== 1 ? `${s.speed}×` : null,
      crop ? `crop ${crop.width}×${crop.height}` : null,
    ].filter(Boolean).join(' ');
    return `${s.format} ${s.width}px ${s.fps}fps ${q}${extras ? ' ' + extras : ''}`;
  }

  function convertAll() {
    for (const card of cards) {
      if (card.status === 'ready' || card.status === 'done' || card.status === 'failed') convert(card);
    }
  }

  $: convertibleCount = cards.filter((c) => ['ready', 'done', 'failed'].includes(c.status)).length;
</script>

{#if globalError}
  <div class="global-error">{globalError}</div>
{:else if health && (!health.tools.ffmpeg || !health.tools.ffprobe)}
  <SetupScreen tools={health.tools} />
{:else}
  <main>
    <header>
      <h1>🎞️ gifify</h1>
      <span class="muted">videos → animated WebP / GIF / tiny MP4</span>
      <div class="spacer" />
      <OutputFolder
        outputDir={serverSettings.outputDir}
        on:saved={(e) => (serverSettings = e.detail)}
      />
    </header>

    <DropZone compact={cards.length > 0} on:files={(e) => addFiles(e.detail)} />

    {#if cards.length > 0}
      <div class="queue">
        {#each cards as card (card.id)}
          <VideoCard
            {card}
            selected={card.id === selectedId}
            on:select={() => (selectedId = card.id)}
            on:remove={() => removeCard(card)}
          />
        {/each}
        {#if convertibleCount > 1}
          <button class="primary convert-all" on:click={convertAll}>Convert all</button>
        {/if}
      </div>
    {/if}

    {#if selected && selected.status !== 'uploading'}
      <Editor
        card={selected}
        on:trim={(e) => patchCard(selected.id, e.detail)}
        on:crop={(e) => patchCard(selected.id, { crop: e.detail.crop })}
      />
      <div class="bottom">
        <SettingsPanel
          card={selected}
          {presets}
          busy={['converting', 'queued'].includes(selected.status)}
          on:preset={(e) => applyPreset(selected, e.detail)}
          on:change={(e) => patchCard(selected.id, { settings: { ...selected.settings, ...e.detail } })}
          on:convert={() => convert(selected)}
          on:autofit={(e) => autoFit(selected, e.detail)}
        />
        <ResultPanel card={selected} />
      </div>
    {/if}
  </main>
{/if}

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 18px 20px 60px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  h1 { margin: 0; font-size: 1.5rem; }
  .spacer { flex: 1; }
  .queue {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
    align-items: stretch;
  }
  .convert-all { align-self: center; white-space: nowrap; }
  .bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  @media (max-width: 860px) {
    .bottom { grid-template-columns: 1fr; }
  }
  .global-error {
    margin: 40px auto;
    max-width: 600px;
    padding: 20px;
    border: 1px solid var(--danger);
    border-radius: var(--radius);
    color: var(--danger);
  }
</style>
