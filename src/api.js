export const API_BASE = import.meta.env.VITE_API_BASE || '';

function baseUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.has('api') ? params.get('api') : API_BASE;
}

async function request(path, { body, timeout = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const base = baseUrl().replace(/\/+$/, '');
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function getLeaderboard() {
  return request('/leaderboard');
}

export async function postRun(run) {
  const options = { body: run, timeout: 20000 };
  const result = await request('/run', options);
  return result ?? request('/run', options);
}

export function getCommentary(stats) {
  return request('/commentary', { body: stats, timeout: 15000 });
}
