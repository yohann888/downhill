import { describe, expect, it } from 'vitest';
import { buildRankOverlayRows } from '../src/leaderboard.js';

const topTen = Array.from({ length: 10 }, (_, index) => ({
  name: `Rider ${index + 1}`,
  time: 100 + index,
}));

describe('buildRankOverlayRows', () => {
  it('highlights the player row when their rank is in the top ten', () => {
    const rows = buildRankOverlayRows(topTen, 4, { name: 'Rider 4', time: 103 });

    expect(rows).toHaveLength(10);
    expect(rows[3]).toMatchObject({
      rank: 4,
      name: 'Rider 4',
      time: 103,
      highlighted: true,
    });
    expect(rows.filter((row) => row.highlighted)).toHaveLength(1);
  });

  it('appends and highlights a player ranked outside the top ten', () => {
    const rows = buildRankOverlayRows(topTen, 12, { name: 'Last Rider', time: 142.5 });

    expect(rows).toHaveLength(11);
    expect(rows[10]).toEqual({
      rank: 12,
      name: 'Last Rider',
      time: 142.5,
      highlighted: true,
    });
  });
});
