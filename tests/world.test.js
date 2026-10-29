import { describe, expect, it } from 'vitest';
import {
  BRAKE_RAMP,
  DT,
  G,
  STEER_MAX_LOW,
  STEER_OVERDEMAND,
  WHEELBASE,
} from '../src/physics/constants.js';
import { createBike, stepBike } from '../src/physics/bike.js';
import { createObstacles } from '../src/world/obstacles.js';
import { createTerrain } from '../src/world/terrain.js';

function scriptedRun(seed) {
  const terrain = createTerrain(seed);
  const obstacles = createObstacles(terrain, seed + 20);
  const bike = createBike({ x: terrain.centerX(0), z: 0 }, terrain);

  for (let step = 0; step < 20 / DT; step += 1) {
    const time = step * DT;
    const input = {
      throttle: time < 8 ? 1 : 0,
      brake: time > 11 && time < 13 ? 1 : 0,
      steer: Math.sin(time * 0.7) * 0.2,
    };
    stepBike(bike, input, terrain, obstacles, DT);
  }
  return bike;
}

function obstacleClearanceFromEdge(obstacle, terrain) {
  const center = terrain.centerX(obstacle.z);
  const offset = obstacle.x - center;
  const extent =
    obstacle.type === 'log'
      ? Math.abs(obstacle.x2 - obstacle.x1) / 2
      : 0;
  return (
    terrain.halfWidth(obstacle.z) +
    Math.abs(offset) -
    extent -
    obstacle.r
  );
}

describe('terrain and obstacle generation', () => {
  it('is deterministic for identical scripted runs', () => {
    expect(scriptedRun(17)).toEqual(scriptedRun(17));
  });

  it('has the target drop and a continuous centerline height except at kicker lips', () => {
    const terrain = createTerrain();
    expect(terrain.totalDrop).toBeGreaterThanOrEqual(200);
    expect(terrain.totalDrop).toBeLessThanOrEqual(260);

    let maxStep = 0;
    for (let s = 0; s < terrain.courseLength; s += 0.1) {
      const crossesLip = terrain.kickers.some(
        (kicker) => kicker.s >= s && kicker.s < s + 0.1,
      );
      const first = terrain.heightAt(terrain.centerX(-s), -s);
      const secondS = s + 0.1;
      const second = terrain.heightAt(
        terrain.centerX(-secondS),
        -secondS,
      );
      if (!crossesLip) maxStep = Math.max(maxStep, Math.abs(second - first));
    }
    expect(maxStep).toBeLessThan(0.5);
  });

  it('places obstacles in order with trail exclusion zones and clear edge gaps', () => {
    const terrain = createTerrain(5);
    const obstacles = createObstacles(terrain, 9);
    expect(obstacles.length).toBeGreaterThan(50);
    for (let index = 1; index < obstacles.length; index += 1) {
      expect(obstacles[index - 1].z).toBeGreaterThanOrEqual(obstacles[index].z);
    }

    const trailObstacles = obstacles.filter((obstacle) => obstacle.type !== 'tree');
    for (const obstacle of trailObstacles) {
      const s = -obstacle.z;
      expect(s).toBeGreaterThanOrEqual(60);
      expect(s).toBeLessThanOrEqual(terrain.courseLength - 30);
      expect(
        terrain.kickers.some(
          (kicker) => s >= kicker.s - 25 && s <= kicker.s + 15,
        ),
      ).toBe(false);
      expect(obstacleClearanceFromEdge(obstacle, terrain)).toBeGreaterThanOrEqual(
        1.6 - 1e-9,
      );
    }

    for (const tree of obstacles.filter((obstacle) => obstacle.type === 'tree')) {
      const offset = Math.abs(tree.x - terrain.centerX(tree.z));
      const width = terrain.halfWidth(tree.z);
      expect(offset).toBeGreaterThanOrEqual(width + 0.5);
      expect(offset).toBeLessThanOrEqual(width + 8);
    }
  });

  it('lets the center-seeking autopilot reach the finish without crashing', () => {
    const terrain = createTerrain();
    const obstacles = createObstacles(terrain);
    const bike = createBike({ x: terrain.centerX(0), z: 0 }, terrain);
    let maxSpeed = bike.v;
    let finishTime = null;

    for (let step = 0; step < 240 / DT; step += 1) {
      const lookAhead = 8;
      let targetX = terrain.centerX(bike.z - lookAhead);
      let targetZ = bike.z - lookAhead;
      const brake = bike.v > 10 ? 1 : 0;
      let nearestObstacle = null;
      let nearestDistance = Infinity;

      for (const obstacle of obstacles) {
        if (obstacle.type === 'tree') continue;
        const distanceAhead = bike.z - obstacle.z;
        if (distanceAhead < 0 || distanceAhead > 25) continue;
        const lateralDistance = Math.abs(obstacle.x - bike.x);
        const distance = Math.hypot(distanceAhead, lateralDistance);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestObstacle = obstacle;
        }
      }

      if (nearestObstacle) {
        const direction =
          nearestObstacle.x >= terrain.centerX(nearestObstacle.z) ? -1 : 1;
        targetX =
          terrain.centerX(nearestObstacle.z) +
          direction * (terrain.halfWidth(nearestObstacle.z) - 0.55);
        targetZ = nearestObstacle.z;
      }

      const forwardDistance = Math.max(1, bike.z - targetZ);
      const desiredHeading = Math.atan2(targetX - bike.x, forwardDistance);
      let headingError = desiredHeading - bike.heading;
      headingError = Math.atan2(Math.sin(headingError), Math.cos(headingError));
      const brakeAfterStep = brake
        ? Math.min(1, bike.brake + DT / BRAKE_RAMP)
        : Math.max(0, bike.brake - (2 * DT) / BRAKE_RAMP);
      const grip = terrain.surfaceAt(bike.x, bike.z).mu * G;
      const availableLat = Math.sqrt(
        Math.max(0, grip * grip - (brakeAfterStep * grip) ** 2),
      );
      const deltaMax = Math.min(
        STEER_MAX_LOW,
        Math.atan(
          (STEER_OVERDEMAND * grip * WHEELBASE) /
            Math.max(bike.v, 1) ** 2,
        ),
      );
      const safeDelta = Math.atan(
        (availableLat * WHEELBASE) / Math.max(bike.v, 0.5) ** 2,
      );
      const maxSteerInput =
        deltaMax > 0 ? Math.min(1, safeDelta / deltaMax) : 0;
      const desiredSteerAngle = Math.atan(
        (2 * WHEELBASE * Math.sin(headingError)) / forwardDistance,
      );
      const steer = Math.max(
        -maxSteerInput,
        Math.min(
          maxSteerInput,
          deltaMax > 0 ? desiredSteerAngle / deltaMax : 0,
        ),
      );

      stepBike(
        bike,
        { throttle: 0, brake, steer },
        terrain,
        obstacles,
        DT,
      );
      maxSpeed = Math.max(maxSpeed, bike.v);
      if (bike.crashed) {
        console.log(
          `autopilot crash at s=${(-bike.z).toFixed(1)} m, v=${bike.v.toFixed(2)} m/s: ${bike.crashed}`,
        );
        break;
      }
      if (bike.z <= terrain.finishZ) {
        finishTime = (step + 1) * DT;
        break;
      }
    }

    if (finishTime !== null) {
      console.log(
        `autopilot finish: ${finishTime.toFixed(2)} s, max speed ${maxSpeed.toFixed(2)} m/s`,
      );
    }
    expect(finishTime).not.toBeNull();
    expect(bike.crashed).toBeNull();
  });
});
