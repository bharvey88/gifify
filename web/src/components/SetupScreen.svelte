<script>
  export let tools = { ffmpeg: false, ffprobe: false };
  const missing = [!tools.ffmpeg && 'ffmpeg', !tools.ffprobe && 'ffprobe'].filter(Boolean).join(' and ');
</script>

<main class="panel">
  <h1>🎞️ gifify needs ffmpeg</h1>
  <p>Couldn't find <strong>{missing}</strong> on your PATH. Install it, then restart gifify:</p>
  <dl>
    <dt>Windows</dt>
    <dd><code>winget install Gyan.FFmpeg</code> (then open a new terminal)</dd>
    <dt>macOS</dt>
    <dd><code>brew install ffmpeg</code></dd>
    <dt>Linux</dt>
    <dd><code>sudo apt install ffmpeg</code> (or your distro's equivalent)</dd>
  </dl>
  <p class="muted">After installing, stop the server (Ctrl+C) and run <code>npm start</code> again.</p>
</main>

<style>
  main {
    max-width: 560px;
    margin: 60px auto;
  }
  h1 { font-size: 1.4rem; margin-top: 0; }
  dt { font-weight: 600; margin-top: 10px; }
  dd { margin: 2px 0 0; }
  code {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px 7px;
  }
</style>
