import { describe, expect, it } from 'vitest';
import {
  BRAKE_RAMP,
  CRR_OFF,
  CRR_TRAIL,
  DT,
  G,
  MU_OFF,
  MU_TRAIL,
  OUT_OF_BOUNDS,
  STEER_MAX_LOW,
  STEER_OVERDEMAND,
  WHEELBASE,
} from '../src/physics/constants.js';
import { createBike, stepBike } from '../src/physics/bike.js';
import {
  createObstacles,
  OTTER_DEPTH_RATIO,
  OTTER_HEIGHT_RATIO,
  updateMovingObstacles,
} from '../src/world/obstacles.js';
import { createTerrain } from '../src/world/terrain.js';
import { createPlaneTerrain } from './helpers.js';

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
    updateMovingObstacles(obstacles, time);
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

function distanceToObstacle(point, obstacle) {
  if (obstacle.type !== 'log') {
    return Math.hypot(point.x - obstacle.x, point.z - obstacle.z);
  }

  const dx = obstacle.x2 - obstacle.x1;
  const dz = obstacle.z2 - obstacle.z1;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - obstacle.x1) * dx + (point.z - obstacle.z1) * dz) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point.x - (obstacle.x1 + t * dx),
    point.z - (obstacle.z1 + t * dz),
  );
}

function returnPathOffset(path, s) {
  const t = Math.max(0, Math.min(1, (s - path.s0) / path.L));
  return path.U0 * (1 - t * t * (3 - 2 * t));
}

describe('terrain and obstacle generation', () => {
  it('is deterministic for identical scripted runs', () => {
    expect(scriptedRun(17)).toEqual(scriptedRun(17));
  });

  it('has the target drop and a continuous centerline height except at kicker lips', () => {
    const terrain = createTerrain();
    expect(terrain.courseLength).toBe(900);
    expect(terrain.checkpoints.map((checkpoint) => checkpoint.s)).toEqual([
      150, 300, 450, 600, 750, 900,
    ]);
    expect(terrain.totalDrop).toBeGreaterThanOrEqual(150);
    expect(terrain.totalDrop).toBeLessThanOrEqual(200);

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

  it('joins return paths to the trail with flat benches and trail grip', () => {
    const terrain = createTerrain(17);
    expect(terrain.returnPaths.length).toBeGreaterThan(0);
    for (const path of terrain.returnPaths) {
      const joinS = path.s0 + path.L - 0.5;
      const joinZ = -joinS;
      const joinX =
        terrain.centerX(joinZ) +
        path.side * (terrain.halfWidth(joinZ) + 0.5);
      expect(terrain.pathWeightAt(joinX, joinZ)).toBeGreaterThan(0.5);

      const s = path.s0 + path.L / 2;
      const z = -s;
      const hw = terrain.halfWidth(z);
      const offset = returnPathOffset(path, s);
      const center = terrain.centerX(z) + path.side * (hw + offset);
      const inner = center - path.side * 0.8;
      const outer = center + path.side * 0.8;
      expect(Math.abs(terrain.heightAt(inner, z) - terrain.heightAt(outer, z))).toBeLessThan(
        0.05,
      );

      const surface = terrain.surfaceAt(center, z);
      expect(surface.crr).toBe(CRR_TRAIL);
      expect(surface.mu).toBe(MU_TRAIL);
    }
  });

  it('blends off-trail surface properties across a shoulder before the boundary', () => {
    const terrain = createTerrain(17);
    for (const z of [-60, -300, -600, -850]) {
      const center = terrain.centerX(z);
      const hw = terrain.halfWidth(z);
      const shoulder = terrain.surfaceAt(center + hw + 2, z);
      expect(shoulder.crr).toBe(CRR_TRAIL);
      expect(shoulder.mu).toBe(MU_TRAIL);
      expect(shoulder.outOfBounds).toBe(false);

      const outside = terrain.surfaceAt(center + hw + 10, z);
      expect(outside.crr).toBe(CRR_OFF);
      expect(outside.mu).toBe(MU_OFF);
      expect(outside.outOfBounds).toBe(false);
      expect(
        terrain.surfaceAt(center + hw + OUT_OF_BOUNDS + 1, z).outOfBounds,
      ).toBe(true);

      let previousCrr = terrain.surfaceAt(center + hw, z).crr;
      for (let distance = 0.25; distance <= 10; distance += 0.25) {
        const crr = terrain.surfaceAt(center + hw + distance, z).crr;
        expect(crr).toBeGreaterThanOrEqual(previousCrr);
        previousCrr = crr;
      }
    }
  });

  it('only crashes for crossing the expanded 24m boundary', () => {
    const terrain = createTerrain(17);
    const z = -60;
    const edge = terrain.centerX(z) + terrain.halfWidth(z);
    const shoulderBike = createBike({ x: edge + 13, z }, terrain);
    stepBike(shoulderBike, { throttle: 0, brake: 0, steer: 0 }, terrain, [], DT);
    expect(shoulderBike.crashed).toBeNull();

    const outsideBike = createBike({ x: edge + OUT_OF_BOUNDS + 1, z }, terrain);
    stepBike(outsideBike, { throttle: 0, brake: 0, steer: 0 }, terrain, [], DT);
    expect(outsideBike.crashed).toBe('off course');
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
        (obstacle.type === 'rock' ? 0.3 : 1.6) - 1e-9,
      );
      if (obstacle.type === 'rock') {
        const width = terrain.halfWidth(obstacle.z);
        const offset = Math.abs(obstacle.x - terrain.centerX(obstacle.z));
        const extent = Math.max(obstacle.r, 0.4);
        expect(obstacle.r).toBeGreaterThanOrEqual(0.6 - 1e-9);
        expect(obstacle.r).toBeLessThanOrEqual(1.35 + 1e-9);
        expect(obstacle.hx).toBe(extent);
        expect(obstacle.hz).toBe(extent * OTTER_DEPTH_RATIO);
        expect(obstacle.h).toBeCloseTo(OTTER_HEIGHT_RATIO * 2 * obstacle.r);
        expect(width - offset - obstacle.r).toBeGreaterThanOrEqual(0.1 - 1e-9);
      }
    }

    for (const seed of [5, 9, 17]) {
      const seededTerrain = createTerrain(seed);
      const seededObstacles = createObstacles(seededTerrain, seed + 20);
      const rocks = seededObstacles.filter((obstacle) => obstacle.type === 'rock');
      for (const rock of rocks) {
        for (const other of seededObstacles) {
          if (other === rock) continue;
          expect(distanceToObstacle(rock, other)).toBeGreaterThanOrEqual(
            rock.r + other.r - 1e-9,
          );
        }
      }
    }

    for (const tree of obstacles.filter((obstacle) => obstacle.type === 'tree')) {
      const offset = Math.abs(tree.x - terrain.centerX(tree.z));
      const width = terrain.halfWidth(tree.z);
      expect(offset).toBeGreaterThanOrEqual(width + 0.5);
      expect(offset).toBeLessThanOrEqual(width + 22);
    }
  });

  it('keeps the outer tree band clear of return paths', () => {
    const terrain = createTerrain(17);
    const trees = createObstacles(terrain, 27).filter((obstacle) => {
      if (obstacle.type !== 'tree') return false;
      const offset = Math.abs(obstacle.x - terrain.centerX(obstacle.z));
      return offset - terrain.halfWidth(obstacle.z) >= 6.5;
    });
    expect(trees.length).toBeGreaterThan(0);

    for (const tree of trees) {
      const s = -tree.z;
      const side = Math.sign(tree.x - terrain.centerX(tree.z));
      expect(Math.abs(tree.x - terrain.centerX(tree.z)) - terrain.halfWidth(tree.z))
        .toBeGreaterThanOrEqual(7);
      expect(Math.abs(tree.x - terrain.centerX(tree.z)) - terrain.halfWidth(tree.z))
        .toBeLessThanOrEqual(22);
      expect(terrain.pathWeightAt(tree.x, tree.z)).toBe(0);

      for (const path of terrain.returnPaths) {
        if (path.side !== side || s < path.s0 - 10 || s > path.s0 + path.L) {
          continue;
        }
        const pathX =
          terrain.centerX(tree.z) +
          side * (terrain.halfWidth(tree.z) + returnPathOffset(path, s));
        expect(Math.abs(tree.x - pathX)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps moving rocks within trail bounds and collides at their updated positions', () => {
    const terrain = createTerrain(5);
    const obstacles = createObstacles(terrain, 25);
    const rocks = obstacles.filter((obstacle) => obstacle.type === 'rock');

    for (let step = 0; step <= 400; step += 1) {
      updateMovingObstacles(obstacles, step * 0.17);
      for (const rock of rocks) {
        const center = terrain.centerX(rock.z);
        const halfWidth = terrain.halfWidth(rock.z);
        expect(rock.x).toBeGreaterThanOrEqual(center - halfWidth + rock.r - 1e-9);
        expect(rock.x).toBeLessThanOrEqual(center + halfWidth - rock.r + 1e-9);
      }
    }

    const movingRock = {
      type: 'rock',
      x: 0,
      z: -1,
      r: 0.75,
      h: 0.8,
      baseX: 0,
      walk: { amp: 1, speed: 1, phase: 0 },
    };
    updateMovingObstacles([movingRock], Math.PI / 2);
    expect(movingRock.x).not.toBe(movingRock.baseX);

    const flatTerrain = createPlaneTerrain();
    const bike = createBike({ x: movingRock.x, z: 0 }, flatTerrain);
    bike.v = 8;
    for (let step = 0; step < 20 && !bike.crashed; step += 1) {
      stepBike(bike, { throttle: 0, brake: 0, steer: 0 }, flatTerrain, [movingRock], DT);
    }

    expect(bike.crashed).toBe('rock');
  });

  it('lets the center-seeking autopilot reach the finish without crashing', () => {
    const terrain = createTerrain();
    const obstacles = createObstacles(terrain);
    const bike = createBike({ x: terrain.centerX(0), z: 0 }, terrain);
    let maxSpeed = bike.v;
    let finishTime = null;

    for (let step = 0; step < 240 / DT; step += 1) {
      const time = step * DT;
      updateMovingObstacles(obstacles, time);
      const lookAhead = 8;
      let targetX = terrain.centerX(bike.z - lookAhead);
      let targetZ = bike.z - lookAhead;
      const brake = bike.v > 10 ? 1 : 0;
      let nearestObstacle = null;
      let nearestObstacleX = 0;
      let nearestDistance = Infinity;

      for (const obstacle of obstacles) {
        if (obstacle.type === 'tree') continue;
        const distanceAhead = bike.z - obstacle.z;
        if (distanceAhead < 0 || distanceAhead > 35) continue;
        const arrivalTime = time + distanceAhead / Math.max(bike.v, 1);
        const obstacleX = obstacle.walk
          ? obstacle.baseX
            + obstacle.walk.amp
              * Math.sin(arrivalTime * obstacle.walk.speed + obstacle.walk.phase)
          : obstacle.x;
        const lateralDistance = Math.abs(obstacleX - bike.x);
        const distance = Math.hypot(distanceAhead, lateralDistance);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestObstacle = obstacle;
          nearestObstacleX = obstacleX;
        }
      }

      if (nearestObstacle) {
        const direction =
          nearestObstacleX >= terrain.centerX(nearestObstacle.z) ? -1 : 1;
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
