export async function apiFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  return r.json();
}

export async function saveConfig(cfg) {
  await apiFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
}
