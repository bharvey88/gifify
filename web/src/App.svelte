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
  // opts.probe: measure-only run (no output-folder save, no history entry).
  // opts.trim: {startSec, endSec} override, used by probe sampling.
  async function convertWith(card, settings, opts = {}) {
    patchCard(card.id, { status: 'queued', pct: 0, error: null });
    const { jobId } = await api.startConvert({
      videoId: card.id,
      ...settings,
      probe: opts.probe === true,
      startSec: opts.trim?.startSec ?? card.startSec,
      endSec: opts.trim?.endSec ?? card.endSec,
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
            ...(opts.probe ? {} : { attempts: [attempt, ...(current?.attempts ?? [])] }),
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

  // Target-size mode. mp4: exact two-pass bitrate targeting (one visible
  // conversion). webp/gif: fast probes on a short sample slice to find the
  // quality, then one real conversion at the answer.
  async function autoFit(card, targetMB) {
    if (!card || ['uploading', 'converting', 'queued'].includes(card.status)) return;
    const targetBytes = targetMB * 1024 * 1024;
    const start = card.startSec ?? 0;
    const end = card.endSec ?? card.durationSec;
    if (!Number.isFinite(end)) {
      patchCard(card.id, { fitNote: 'Auto-fit needs a known clip length — set an end point on the scrubber first.' });
      return;
    }
    const speed = card.settings.speed || 1;
    const outLen = Math.max((end - start) / speed, 0.1);
    const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

    try {
      if (card.settings.format === 'mp4') {
        // Exact math: size / duration = bitrate; verify, correct once if off.
        let bitrate = ts.mp4BitrateFor(targetBytes, outLen);
        patchCard(card.id, { fitNote: `Targeting ${targetMB} MB with two-pass encoding…` });
        let attempt = await convertWith(card, { ...card.settings, videoBitrate: bitrate });
        if (attempt.bytes > targetBytes) {
          bitrate = Math.floor(bitrate * (targetBytes / attempt.bytes) * 0.97);
          patchCard(card.id, { fitNote: `Slightly over (${mb(attempt.bytes)}) — correcting…` });
          attempt = await convertWith(card, { ...card.settings, videoBitrate: bitrate });
        }
        patchCard(card.id, {
          fitNote: attempt.bytes <= targetBytes
            ? `✓ Fits: ${mb(attempt.bytes)} under the ${targetMB} MB target`
            : `Landed at ${mb(attempt.bytes)} — x264 couldn't go lower without a shorter clip or smaller width`,
        });
        return;
      }

      // webp/gif: probe on the middle few seconds, scale up the estimate.
      const win = ts.sampleWindow(start, end);
      const sampleLen = (win.endSec - win.startSec) / speed;
      const probeTarget = targetBytes * ts.SAFETY_MARGIN;
      let state = ts.initSearch(card.settings.format, card.settings);
      for (;;) {
        const axis = ts.nextProbe(state);
        if (axis == null) break;
        patchCard(card.id, { fitNote: `Estimating size — quick probe ${state.attempts + 1} (${ts.describeAxis(state, axis)})…` });
        const probe = await convertWith(card, ts.axisToSettings(state, axis), { probe: true, trim: win });
        const estimated = ts.estimateFullBytes(probe.bytes, sampleLen, outLen);
        state = ts.recordResult(state, axis, estimated, probeTarget, probe.jobId);
      }

      const pick = state.best ?? state.smallest;
      patchCard(card.id, { fitNote: `Converting the full clip at ${ts.describeAxis(state, pick.axis)}…` });
      let attempt = await convertWith(card, ts.axisToSettings(state, pick.axis));

      // The sample can under-estimate; take one corrective step down if over.
      if (attempt.bytes > targetBytes && pick.axis - state.step >= state.lo0) {
        const lower = pick.axis - state.step;
        patchCard(card.id, { fitNote: `Slightly over (${mb(attempt.bytes)}) — one step down to ${ts.describeAxis(state, lower)}…` });
        attempt = await convertWith(card, ts.axisToSettings(state, lower));
        pick.axis = lower;
      }

      if (attempt.bytes <= targetBytes) {
        patchCard(card.id, {
          settings: ts.axisToSettings(state, pick.axis),
          fitNote: `✓ Fits: ${mb(attempt.bytes)} at ${ts.describeAxis(state, pick.axis)}`,
        });
      } else {
        patchCard(card.id, {
          fitNote: `Couldn't get under ${targetMB} MB — landed at ${mb(attempt.bytes)}. Try a shorter trim, lower fps, or a smaller width.`,
        });
      }
    } catch (err) {
      patchCard(card.id, { fitNote: `Auto-fit stopped: ${err.message}` });
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
