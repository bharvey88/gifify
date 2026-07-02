async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const getHealth = () => fetch('/api/health').then(json);
export const getPresets = () => fetch('/api/presets').then(json);
export const getSettings = () => fetch('/api/settings').then(json);

export const putSettings = (settings) =>
  fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json);

export async function uploadVideo(file) {
  const form = new FormData();
  form.append('video', file);
  return fetch('/api/videos', { method: 'POST', body: form }).then(json);
}

export const deleteVideo = (id) => fetch(`/api/videos/${id}`, { method: 'DELETE' }).then(json);

export const streamUrl = (id) => `/api/videos/${id}/stream`;
export const resultUrl = (jobId) => `/api/jobs/${jobId}/result`;
export const downloadUrl = (jobId) => `/api/jobs/${jobId}/result?download`;

export const startConvert = (payload) =>
  fetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json);

// Subscribe to job progress. Calls onEvent for each message; auto-closes on
// done/failed. Returns a close function.
export function watchJob(jobId, onEvent) {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (e) => {
    const data = JSON.parse(e.data);
    onEvent(data);
    if (data.status === 'done' || data.status === 'failed') source.close();
  };
  source.onerror = () => source.close();
  return () => source.close();
}
