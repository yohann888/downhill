import { describe, expect, it } from 'vitest';
import { landingPuffCount, roostAmount } from '../src/render/dust.js';
import { groundCoverPlacements } from '../src/render/groundcover.js';
import { createTerrain } from '../src/world/terrain.js';

describe('ground cover', () => {
  const terrain = createTerrain(1);
  const items = groundCoverPlacements(terrain);

  it('is deterministic and stays off the riding line', () => {
    expect(groundCoverPlacements(terrain)).toEqual(items);
    expect(items.length).toBeGreaterThan(2000);
    for (const item of items) {
      expect(Math.abs(item.x - terrain.centerX(item.z))).toBeGreaterThan(terrain.halfWidth(item.z));
      expect(terrain.pathWeightAt(item.x, item.z)).toBeLessThanOrEqual(0.2);
    }
  });

  it('mixes ferns into the grass', () => {
    const ferns = items.filter((item) => item.kind === 'fern').length;
    expect(ferns / items.length).toBeGreaterThan(0.02);
    expect(ferns / items.length).toBeLessThan(0.3);
  });
});

describe('roost and landing dust', () => {
  it('roosts only on fast hard corners while grounded', () => {
    expect(roostAmount({ aLat: 3, v: 15 })).toBe(0);
    expect(roostAmount({ aLat: 7.5, v: 5 })).toBe(0);
    expect(roostAmount({ aLat: 7.5, v: 15 })).toBe(1);
    expect(roostAmount({ aLat: 7.5, v: 15, airborne: true })).toBe(0);
  });

  it('scales the landing puff with impact', () => {
    expect(landingPuffCount(1)).toBe(8);
    expect(landingPuffCount(6)).toBeGreaterThan(landingPuffCount(3));
    expect(landingPuffCount(20)).toBe(98);
  });
});
