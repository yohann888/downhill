import { describe, expect, it } from 'vitest';
import {
  crashVariant, landingSound, offTrailAmount, pickTake, sortTreesByZ, tireMix, treePasses,
} from '../src/sfx-mix.js';

const trees = sortTreesByZ([
  { type: 'tree', x: 2, z: -100 },
  { type: 'rock', x: 0, z: -101 },
  { type: 'tree', x: -1, z: -102 },
  { type: 'tree', x: 9, z: -103 },
]);

describe('treePasses', () => {
  it('fires once per close tree crossed this step, panned to its side', () => {
    const passes = treePasses(trees, -99.5, -102.5, 0, 15);
    expect(passes).toHaveLength(2);
    const pans = passes.map((pass) => pass.pan).sort((a, b) => a - b);
    expect(pans[0]).toBeLessThan(0);
    expect(pans[1]).toBeGreaterThan(0);
  });

  it('ignores far trees, slow riding, uphill moves and respawn teleports', () => {
    expect(treePasses(trees, -102.5, -103.5, 0, 15)).toEqual([]);
    expect(treePasses(trees, -99.5, -100.5, 0, 3)).toEqual([]);
    expect(treePasses(trees, -100.5, -99.5, 0, 15)).toEqual([]);
    expect(treePasses(trees, -50, -101, 0, 15)).toEqual([]);
  });

  it('louder for closer trees and faster riding', () => {
    const near = treePasses(trees, -99.5, -100.5, 1.5, 20)[0];
    const far = treePasses(trees, -99.5, -100.5, -1.5, 20)[0];
    const slow = treePasses(trees, -99.5, -100.5, 1.5, 8)[0];
    expect(near.volume).toBeGreaterThan(far.volume);
    expect(near.volume).toBeGreaterThan(slow.volume);
  });
});

describe('landingSound', () => {
  it('gets louder, lower and adds a thump as impact grows', () => {
    const soft = landingSound(2);
    const hard = landingSound(11);
    expect(hard.volume).toBeGreaterThan(soft.volume);
    expect(hard.rate).toBeLessThan(soft.rate);
    expect(soft.thump).toBe(0);
    expect(hard.thump).toBeCloseTo(1);
  });
});

describe('crashVariant', () => {
  it('stays within a small pitch and offset window', () => {
    expect(crashVariant(() => 0)).toMatchObject({ rate: 0.88, offset: 0 });
    const high = crashVariant(() => 1);
    expect(high.rate).toBeCloseTo(1.12);
    expect(high.offset).toBeCloseTo(0.12);
  });
});

describe('surface tires', () => {
  const terrain = { centerX: () => 0, halfWidth: () => 3, pathWeightAt: (x) => (x > 10 ? 1 : 0) };

  it('is on trail inside the half width and off trail past it', () => {
    expect(offTrailAmount(terrain, 2, 0)).toBe(0);
    expect(offTrailAmount(terrain, -6, 0)).toBe(1);
    expect(offTrailAmount(terrain, 11, 0)).toBe(0);
  });

  it('crossfades dirt and gravel into grass', () => {
    expect(tireMix(1, 0).grass).toBe(0);
    expect(tireMix(1, 1).dirt).toBe(0);
    expect(tireMix(1, 1).grass).toBeGreaterThan(0.9);
  });
});

describe('voice takes', () => {
  it('never repeats the last take', () => {
    let last;
    for (let i = 0; i < 50; i += 1) {
      const take = pickTake(['a', 'b', 'c'], last);
      expect(take).not.toBe(last);
      last = take;
    }
  });

  it('falls back to the only take', () => {
    expect(pickTake(['a'], 'a')).toBe('a');
  });
});
