import { afterEach, describe, expect, it, vi } from 'vitest';
import { postRun } from '../src/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
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
