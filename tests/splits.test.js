import { describe, expect, it } from 'vitest';
import {
  ghostTimeAtZ,
  loadBestSplits,
  saveBestSplits,
  splitDelta,
} from '../src/splits.js';

describe('split helpers', () => {
  it('computes player split differences and rejects invalid values', () => {
    expect(splitDelta(14.16, 15)).toBeCloseTo(-0.84);
    expect(splitDelta(15.4, 15)).toBeCloseTo(0.4);
    expect(splitDelta(Number.NaN, 15)).toBeNull();
  });

  it('interpolates the first ghost checkpoint crossing', () => {
    const ghost = { dt: 0.5, frames: [[0, 0, 3, 0, 0], [0, 0, 2, 0, 0], [0, 0, 1, 0, 0]] };
    expect(ghostTimeAtZ(ghost, 1.5)).toBeCloseTo(0.75);
    expect(ghostTimeAtZ({ ...ghost, frames: [[0, 0, 1, 0, 0]] }, 1.5)).toBe(0);
    expect(ghostTimeAtZ(ghost, -1)).toBeNull();
  });

  it('persists best splits only for the matching checkpoint count', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    expect(saveBestSplits(storage, 2, [10, 22])).toBe(true);
    expect(loadBestSplits(storage, 2)).toEqual([10, 22]);
    expect(loadBestSplits(storage, 3)).toBeNull();
    expect(saveBestSplits(storage, 2, [10])).toBe(false);
  });
});
