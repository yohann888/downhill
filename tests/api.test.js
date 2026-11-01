import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, getLeaderboard, postRun } from '../src/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('leaderboard submission', () => {
  it('retries a null response once for cold-start recovery', async () => {
    const result = { rank: 3, top: [] };
    vi.stubGlobal('window', { location: { search: '' } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => result,
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postRun({ name: 'Rider', time: 30 })).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/run');
    expect(fetchMock.mock.calls[1][0]).toBe('/run');
  });
});

describe('api base override', () => {
  it('ignores the ?api= query parameter in production builds', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { location: { search: '?api=https://evil.example' } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ top: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await getLeaderboard();
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/leaderboard`);
  });

  it('honours the ?api= query parameter in dev builds', async () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('window', { location: { search: '?api=http://localhost:8000' } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ top: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await getLeaderboard();
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/leaderboard');
  });
});
