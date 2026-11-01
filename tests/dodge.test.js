import { describe, expect, it } from 'vitest';
import { createDodgeTracker, updateDodgeTracker } from '../src/dodge.js';
import { obstacleClearance } from '../src/physics/bike.js';

function obstacleAtClearance(targetClearance, z = 0) {
  const obstacle = { type: 'rock', x: 0, z, hx: 0.3, hz: 0.45, r: 0.3, h: 0.4 };
  let low = 0;
  let high = 4;
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const middle = (low + high) / 2;
    if (obstacleClearance(obstacle, middle, z) < targetClearance) low = middle;
    else high = middle;
  }
  obstacle.x = (low + high) / 2;
  return obstacle;
}

function passObstacle(obstacle, { speed = 5, crash = false } = {}) {
  const tracker = createDodgeTracker();
  updateDodgeTracker(tracker, { x: 0, z: obstacle.z, v: speed }, [obstacle], 0);
  return updateDodgeTracker(
    tracker,
    { x: 0, z: obstacle.z + 2.1, v: speed, crashed: crash },
    [obstacle],
    1,
  );
}

describe('otter dodge tracking', () => {
  it('awards a close pass but not a wider pass', () => {
    expect(passObstacle(obstacleAtClearance(0.4)).map((event) => event.type)).toEqual(['dodge']);
    expect(passObstacle(obstacleAtClearance(0.8))).toEqual([]);
  });

  it('requires speed above 15 km/h and cancels on a crash', () => {
    expect(passObstacle(obstacleAtClearance(0.2), { speed: 4 })).toEqual([]);
    expect(passObstacle(obstacleAtClearance(0.2), { crash: true })).toEqual([]);
  });

  it('enforces a five-second per-otter cooldown', () => {
    const tracker = createDodgeTracker();
    const obstacle = obstacleAtClearance(0.2);
    const enter = (time) => updateDodgeTracker(
      tracker,
      { x: 0, z: obstacle.z, v: 5 },
      [obstacle],
      time,
    );
    const leave = (time) => updateDodgeTracker(
      tracker,
      { x: 0, z: obstacle.z + 2.1, v: 5 },
      [obstacle],
      time,
    );
    enter(0);
    expect(leave(1).map((event) => event.type)).toEqual(['dodge']);
    enter(2);
    expect(leave(3)).toEqual([]);
    enter(6);
    expect(leave(7).map((event) => event.type)).toEqual(['dodge']);
  });

  it('awards and resets the three-dodge combo within four seconds', () => {
    const tracker = createDodgeTracker();
    const otters = [0, 1, 2].map((index) => obstacleAtClearance(0.2, index * 10));
    const events = otters.flatMap((obstacle, index) => {
      updateDodgeTracker(
        tracker,
        { x: 0, z: obstacle.z, v: 5 },
        [obstacle],
        index,
      );
      return updateDodgeTracker(
        tracker,
        { x: 0, z: obstacle.z + 2.1, v: 5 },
        [obstacle],
        index + 0.5,
      );
    });
    expect(events.filter((event) => event.type === 'dodge')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'combo')).toHaveLength(1);
    expect(tracker.comboTimes).toEqual([]);
  });
});
