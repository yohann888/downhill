import { describe, expect, it } from 'vitest';
import { createObstacles } from '../src/world/obstacles.js';
import { createPickups } from '../src/world/pickups.js';
import { createTerrain } from '../src/world/terrain.js';

describe('pickup placement', () => {
  it('places two energy drinks and two coffees in deterministic course order', () => {
    const terrain = createTerrain();
    const obstacles = createObstacles(terrain);
    const pickups = createPickups(terrain, obstacles);

    expect(pickups).toEqual(createPickups(terrain, obstacles));
    expect(pickups.map((pickup) => pickup.type)).toEqual([
      'energy',
      'coffee',
      'energy',
      'coffee',
    ]);
    expect(pickups.map((pickup) => pickup.s)).toEqual(
      [...pickups].map((pickup) => pickup.s).sort((a, b) => a - b),
    );

    for (const pickup of pickups) {
      const desiredS = terrain.courseLength * (
        pickup.type === 'energy'
          ? pickups.indexOf(pickup) === 0 ? 0.1 : 0.48
          : pickups.indexOf(pickup) === 1 ? 0.29 : 0.66
      );
      expect(pickup.s).toBeGreaterThanOrEqual(desiredS - 40);
      expect(pickup.s).toBeLessThanOrEqual(desiredS + 40);
      expect(pickup.x).toBe(terrain.centerX(pickup.z));
      expect(pickup.z).toBe(-pickup.s);
      expect(pickup.taken).toBe(false);
      expect(
        terrain.kickers.some(
          (kicker) =>
            pickup.s >= kicker.s - 25 && pickup.s <= kicker.s + 15,
        ),
      ).toBe(false);
      expect(
        obstacles
          .filter((obstacle) => obstacle.type !== 'tree')
          .every((obstacle) => Math.abs(obstacle.z - pickup.z) >= 6),
      ).toBe(true);
    }
  });
});
