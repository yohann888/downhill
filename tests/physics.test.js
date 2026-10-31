import { describe, expect, it } from 'vitest';
import {
  BRAKE_RAMP,
  CDA,
  CRR_TRAIL,
  DT,
  G,
  M,
  MU_TRAIL,
  PEDAL_POWER,
  RHO,
  STEER_MAX_LOW,
  WASHOUT_TIME,
  WHEELBASE,
} from '../src/physics/constants.js';
import { createBike, stepBike } from '../src/physics/bike.js';
import { airTimeBonus } from '../src/feel.js';
import {
  OTTER_DEPTH_RATIO,
  OTTER_HEIGHT_RATIO,
} from '../src/world/obstacles.js';
import { createPlaneTerrain, createStepDropTerrain } from './helpers.js';

const noInput = { throttle: 0, brake: 0, steer: 0 };

function createHeightTerrain(heightAt) {
  return {
    heightAt,
    surfaceAt: () => ({ crr: CRR_TRAIL, mu: MU_TRAIL, outOfBounds: false }),
    centerX: () => 0,
    courseLength: 900,
    halfWidth: () => 100,
  };
}

describe('bike physics', () => {
  it('increases load in a sag and decreases it over a crest', () => {
    const sagTerrain = createHeightTerrain((_x, z) => 0.02 * (z + 50) ** 2);
    const sag = createBike({ x: 0, z: -50 }, sagTerrain);
    sag.v = 20;
    for (let elapsed = 0; elapsed < 0.375; elapsed += DT) {
      stepBike(sag, noInput, sagTerrain, [], DT);
    }
    expect(sag.load).toBeGreaterThan(1.15);

    const crestTerrain = createHeightTerrain((_x, z) => -0.02 * (z + 50) ** 2);
    const crest = createBike({ x: 0, z: -50 }, crestTerrain);
    crest.v = 8;
    for (let elapsed = 0; elapsed < 0.3; elapsed += DT) {
      stepBike(crest, noInput, crestTerrain, [], DT);
    }
    expect(crest.load).toBeLessThan(0.85);
  });

  it('lets steep camber steer the bike downhill without affecting gentle camber', () => {
    const steepTerrain = createHeightTerrain((x) => 0.8 * x);
    const steep = createBike({ x: 0, z: 0 }, steepTerrain);
    steep.v = 12;
    for (let elapsed = 0; elapsed < 1; elapsed += DT) {
      stepBike(steep, noInput, steepTerrain, [], DT);
    }
    expect(steep.heading).toBeLessThan(-0.01);
    expect(steep.crashed).toBeNull();

    const gentleTerrain = createHeightTerrain((x) => 0.2 * x);
    const gentle = createBike({ x: 0, z: 0 }, gentleTerrain);
    gentle.v = 12;
    for (let elapsed = 0; elapsed < 1; elapsed += DT) {
      stepBike(gentle, noInput, gentleTerrain, [], DT);
    }
    expect(Math.abs(gentle.heading)).toBeLessThan(0.01);
  });

  it('lets a right bank increase right-turn yaw and never washes out from camber alone', () => {
    const flatTerrain = createHeightTerrain(() => 0);
    const bankedTerrain = createHeightTerrain((x) => -0.3 * x);
    const flat = createBike({ x: 0, z: 0 }, flatTerrain);
    const banked = createBike({ x: 0, z: 0 }, bankedTerrain);
    const fullSteer = Math.atan((1.1 * MU_TRAIL * G * WHEELBASE) / 18 ** 2);
    flat.v = 18;
    banked.v = 18;
    flat.steer = fullSteer;
    banked.steer = fullSteer;
    stepBike(flat, { ...noInput, steer: 1 }, flatTerrain, [], DT);
    stepBike(banked, { ...noInput, steer: 1 }, bankedTerrain, [], DT);
    expect(flat.slipping).toBe(true);
    expect(banked.heading).toBeGreaterThan(flat.heading);

    const steepTerrain = createHeightTerrain((x) => 0.8 * x);
    const steep = createBike({ x: 0, z: 0 }, steepTerrain);
    steep.v = 15;
    for (let elapsed = 0; elapsed < 2; elapsed += DT) {
      stepBike(steep, noInput, steepTerrain, [], DT);
    }
    expect(steep.crashed).not.toBe('washout');
  });

  it('converges to analytic terminal velocity on a 30% grade', () => {
    const terrain = createPlaneTerrain(0.3);
    const bike = createBike({ x: 0, z: 0 }, terrain);
    const theta = Math.atan(0.3);
    const expected = Math.sqrt(
      (2 *
        M *
        G *
        (Math.sin(theta) - CRR_TRAIL * Math.cos(theta))) /
        (RHO * CDA),
    );

    for (let elapsed = 0; elapsed < 120; elapsed += DT) {
      stepBike(bike, noInput, terrain, [], DT);
    }

    console.log(`30% grade terminal velocity: ${bike.v.toFixed(2)} m/s`);
    expect(Math.abs(bike.v - expected) / expected).toBeLessThan(0.02);
  });

  it('reaches pedal-power-limited speed on flat ground', () => {
    const terrain = createPlaneTerrain();
    const bike = createBike({ x: 0, z: 0 }, terrain);
    const rollingForce = CRR_TRAIL * M * G;
    const quadraticDrag = 0.5 * RHO * CDA;
    let low = 0;
    let high = 100;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) / 2;
      if (PEDAL_POWER / middle > rollingForce + quadraticDrag * middle ** 2) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const expected = (low + high) / 2;
    const throttle = { throttle: 1, brake: 0, steer: 0 };

    for (let elapsed = 0; elapsed < 60; elapsed += DT) {
      stepBike(bike, throttle, terrain, [], DT);
    }

    console.log(`pedal top speed: ${bike.v.toFixed(2)} m/s`);
    expect(Math.abs(bike.v - expected) / expected).toBeLessThan(0.03);
  });

  it('ramps braking, stops without reversing, and matches an independent stopping integrator', () => {
    const terrain = createPlaneTerrain();
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.v = 15;
    const grip = MU_TRAIL * G;
    const tinyDt = 1e-5;
    let expectedSpeed = 15;
    let expectedBrake = 0;
    let expectedDistance = 0;
    while (expectedSpeed > 0) {
      expectedBrake = Math.min(1, expectedBrake + tinyDt / BRAKE_RAMP);
      const drag = (0.5 * RHO * CDA * expectedSpeed ** 2) / M;
      const acceleration =
        -CRR_TRAIL * G - drag - expectedBrake * grip;
      expectedSpeed = Math.max(0, expectedSpeed + acceleration * tinyDt);
      expectedDistance += expectedSpeed * tinyDt;
    }

    const brake = { throttle: 0, brake: 1, steer: 0 };
    let previousZ = bike.z;
    let steps = 0;
    while (bike.v > 0 && steps < 120 * 5) {
      stepBike(bike, brake, terrain, [], DT);
      expect(bike.v).toBeGreaterThanOrEqual(0);
      expect(bike.z).toBeLessThanOrEqual(previousZ);
      previousZ = bike.z;
      steps += 1;
    }

    const stoppingDistance = -bike.z;
    console.log(`braking distance: ${stoppingDistance.toFixed(2)} m`);
    expect(bike.v).toBe(0);
    expect(Math.abs(stoppingDistance - expectedDistance) / expectedDistance).toBeLessThan(
      0.05,
    );
  });

  it('reports skid under hard braking, but not while coasting or airborne', () => {
    const terrain = createPlaneTerrain();
    const braking = createBike({ x: 0, z: 0 }, terrain);
    braking.v = 15;
    const brake = { throttle: 0, brake: 1, steer: 0 };
    for (let elapsed = 0; elapsed < 0.4; elapsed += DT) {
      stepBike(braking, brake, terrain, [], DT);
    }
    expect(braking.skid).toBeGreaterThan(0.5);

    const coasting = createBike({ x: 0, z: 0 }, terrain);
    coasting.v = 15;
    stepBike(coasting, noInput, terrain, [], DT);
    expect(coasting.skid).toBeCloseTo(0);

    const airborne = createBike({ x: 0, z: 0 }, terrain);
    airborne.v = 15;
    airborne.airborne = true;
    stepBike(airborne, brake, terrain, [], DT);
    expect(airborne.skid).toBe(0);
  });

  it('hops about 0.62 m, observes cooldown, and stays below the air-bonus threshold', () => {
    const terrain = createPlaneTerrain();
    const bike = createBike({ x: 0, z: 0 }, terrain);
    const jump = { ...noInput, jump: 1 };
    stepBike(bike, jump, terrain, [], DT);
    expect(bike.airborne).toBe(true);
    expect(bike.jumpCooldown).toBeCloseTo(0.4);

    let maxHeight = bike.y;
    let airtime = 0;
    for (let elapsed = 0; elapsed < 1 && bike.airborne; elapsed += DT) {
      stepBike(bike, noInput, terrain, [], DT);
      airtime += DT;
      maxHeight = Math.max(maxHeight, bike.y);
    }

    expect(maxHeight).toBeCloseTo(0.62, 1);
    expect(airtime).toBeCloseTo(0.7, 1);
    expect(airTimeBonus(airtime)).toBe(0);

    const cooldownBike = createBike({ x: 0, z: 0 }, terrain);
    stepBike(cooldownBike, jump, terrain, [], DT);
    cooldownBike.airborne = false;
    cooldownBike.y = terrain.heightAt(cooldownBike.x, cooldownBike.z);
    cooldownBike.vy = 0;
    const cooldown = cooldownBike.jumpCooldown;
    stepBike(cooldownBike, jump, terrain, [], DT);
    expect(cooldownBike.jumpCooldown).toBeLessThan(cooldown);
    expect(cooldownBike.jumpCooldown).toBeGreaterThan(0);
    expect(cooldownBike.airborne).toBe(false);
  });

  it('turns toward positive x at low speed with the expected yaw rate', () => {
    const terrain = createPlaneTerrain();
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.v = 3;
    const steer = { throttle: 0, brake: 0, steer: 1 };
    let previousHeading = bike.heading;
    for (let elapsed = 0; elapsed < 1; elapsed += DT) {
      bike.v = 3;
      previousHeading = bike.heading;
      stepBike(bike, steer, terrain, [], DT);
    }
    const deltaMax = Math.min(
      STEER_MAX_LOW,
      Math.atan((1.1 * MU_TRAIL * G * WHEELBASE) / 9),
    );
    const expectedYawRate = (3 * Math.tan(deltaMax)) / WHEELBASE;
    const yawRate = (bike.heading - previousHeading) / DT;

    expect(bike.heading).toBeGreaterThan(0);
    expect(Math.abs(yawRate - expectedYawRate) / expectedYawRate).toBeLessThan(
      0.03,
    );
  });

  it('limits lateral acceleration during high-speed cornering without washout', () => {
    const terrain = createPlaneTerrain();
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.v = 18;
    const steer = { throttle: 0, brake: 0, steer: 1 };

    for (let elapsed = 0; elapsed < 3; elapsed += DT) {
      stepBike(bike, steer, terrain, [], DT);
    }

    expect(bike.crashed).toBeNull();
    expect(bike.slipping).toBe(true);
    expect(Math.abs(bike.aLat)).toBeLessThanOrEqual(MU_TRAIL * G + 1e-6);
  });

  it('washes out under high-speed steering and braking, but not at low speed', () => {
    const terrain = createPlaneTerrain();
    const highSpeed = createBike({ x: 0, z: 0 }, terrain);
    highSpeed.v = 18;
    const hardCorner = { throttle: 0, brake: 1, steer: 1 };
    let elapsed = 0;
    while (!highSpeed.crashed && elapsed < 1) {
      stepBike(highSpeed, hardCorner, terrain, [], DT);
      elapsed += DT;
    }
    expect(highSpeed.crashed).toBe('washout');
    expect(elapsed).toBeLessThan(1);
    expect(highSpeed.slipTimer).toBeGreaterThan(WASHOUT_TIME);

    const lowSpeed = createBike({ x: 0, z: 0 }, terrain);
    lowSpeed.v = 4;
    for (let time = 0; time < 3; time += DT) {
      stepBike(lowSpeed, hardCorner, terrain, [], DT);
    }
    expect(lowSpeed.crashed).not.toBe('washout');
  });

  it('lands from step drops without crashing', () => {
    for (const { drop, expectedCrash } of [
      { drop: 1.5, expectedCrash: null },
      { drop: 18, expectedCrash: null },
    ]) {
      const terrain = createStepDropTerrain(drop);
      const bike = createBike({ x: 0, z: 0 }, terrain);
      bike.v = 12;
      let wasAirborne = false;
      for (let elapsed = 0; elapsed < 4 && !bike.crashed; elapsed += DT) {
        stepBike(bike, noInput, terrain, [], DT);
        wasAirborne ||= bike.airborne;
      }
      expect(wasAirborne).toBe(true);
      expect(bike.airborne).toBe(false);
      expect(bike.crashed).toBe(expectedCrash);
      if (drop === 1.5) {
        expect(bike.airborne).toBe(false);
      }
    }
  });

  it('keeps speed through a medium-hard 4m flat landing without crashing', () => {
    const terrain = createPlaneTerrain();
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.y += 4;
    bike.airborne = true;
    bike.v = 10;
    let speedBeforeLanding = bike.v;
    for (let elapsed = 0; elapsed < 5 && bike.airborne; elapsed += DT) {
      speedBeforeLanding = bike.v;
      stepBike(bike, noInput, terrain, [], DT);
    }

    expect(bike.airborne).toBe(false);
    expect(bike.crashed).toBeNull();
    expect(bike.heavyLanding).toBe(true);
    expect(bike.landingImpact).toBeCloseTo(Math.sqrt(2 * G * 4), 0);
    expect(bike.v).toBeGreaterThan(speedBeforeLanding * 0.99);
    expect(bike.v).toBeGreaterThan(9.5);

    stepBike(bike, noInput, createPlaneTerrain(), [], DT);
    expect(bike.heavyLanding).toBe(false);
    expect(bike.landingImpact).toBe(0);
  });

  it('lands from 17m and 30m falls without crashing or losing horizontal speed', () => {
    for (const height of [17, 30]) {
      const terrain = createPlaneTerrain();
      const bike = createBike({ x: 0, z: 0 }, terrain);
      bike.y += height;
      bike.airborne = true;
      bike.v = 10;
      let speedBeforeLanding = bike.v;
      for (let elapsed = 0; elapsed < 5 && bike.airborne; elapsed += DT) {
        speedBeforeLanding = bike.v;
        stepBike(bike, noInput, terrain, [], DT);
      }

      expect(bike.airborne).toBe(false);
      expect(bike.crashed).toBeNull();
      expect(bike.heavyLanding).toBe(true);
      expect(bike.v).toBeGreaterThan(speedBeforeLanding * 0.99);
    }
  });

  it('does not scrub speed landing onto a 0.3 downslope at 18m/s', () => {
    const terrain = createPlaneTerrain(0.3);
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.y += 0.02;
    bike.airborne = true;
    bike.v = 18;
    bike.vy = -Math.sqrt(2 * G * 4);
    stepBike(bike, noInput, terrain, [], DT);

    expect(bike.airborne).toBe(false);
    expect(bike.crashed).toBeNull();
    expect(bike.heavyLanding).toBe(false);
    expect(bike.v).toBeGreaterThan(18 * 0.85);
  });

  it('crashes at speed on a rock, pushes a slow bike clear, and can jump a log', () => {
    const terrain = createPlaneTerrain();
    const rock = { type: 'rock', x: 0, z: -1, r: 1.05, h: 0.9, rot: 0 };
    const fast = createBike({ x: 0, z: 0 }, terrain);
    fast.v = 8;
    for (let elapsed = 0; elapsed < 1 && !fast.crashed; elapsed += DT) {
      stepBike(fast, noInput, terrain, [rock], DT);
    }
    expect(fast.crashed).toBe('rock');

    const slow = createBike({ x: 0, z: 0 }, terrain);
    slow.v = 2;
    for (let elapsed = 0; elapsed < 2; elapsed += DT) {
      stepBike(slow, noInput, terrain, [rock], DT);
    }
    expect(slow.crashed).toBeNull();
    expect(slow.v).toBe(0);
    expect(Math.hypot(slow.x - rock.x, slow.z - rock.z)).toBeGreaterThanOrEqual(
      slow.v + 0.35 + rock.r - 1e-9,
    );

    const log = {
      type: 'log',
      x: 0,
      z: -0.3,
      x1: -1,
      z1: -0.3,
      x2: 1,
      z2: -0.3,
      r: 0.2,
      h: 0.4,
      rot: 0,
    };
    const jumper = createBike({ x: 0, z: 0 }, terrain);
    jumper.v = 8;
    jumper.y += 1;
    jumper.airborne = true;
    for (let elapsed = 0; elapsed < 0.1; elapsed += DT) {
      stepBike(jumper, noInput, terrain, [log], DT);
    }
    expect(jumper.crashed).toBeNull();
  });

  it('crashes into a tree trunk but only bursts foliage once outside the trunk', () => {
    const terrain = createPlaneTerrain();
    const tree = {
      type: 'tree',
      x: 0,
      z: -1,
      r: 0.32,
      foliageRadius: 1.6,
      h: 10,
    };
    const trunkHit = createBike({ x: 0, z: 0 }, terrain);
    trunkHit.v = 8;
    for (let elapsed = 0; elapsed < 1 && !trunkHit.crashed; elapsed += DT) {
      stepBike(trunkHit, noInput, terrain, [tree], DT);
    }
    expect(trunkHit.crashed).toBe('tree');

    const foliageBike = createBike({ x: 0.9, z: 0 }, terrain);
    foliageBike.v = 8;
    const baseline = createBike({ x: 0.9, z: 0 }, terrain);
    baseline.v = 8;
    let foliageBursts = 0;
    for (let elapsed = 0; elapsed < 2; elapsed += DT) {
      stepBike(foliageBike, noInput, terrain, [tree], DT);
      stepBike(baseline, noInput, terrain, [], DT);
      if (foliageBike.foliageHit) foliageBursts += 1;
    }
    expect(foliageBike.crashed).toBeNull();
    expect(foliageBursts).toBe(1);
    expect(foliageBike.v).toBeCloseTo(baseline.v, 8);
  });

  it('passes above an otter but Ottifies on contact below its visible height', () => {
    const terrain = createPlaneTerrain();
    const rock = {
      type: 'rock',
      x: 0,
      z: -1,
      r: 1.05,
      hx: 1.05,
      hz: 1.05 * OTTER_DEPTH_RATIO,
      h: 0.9,
    };
    const bikeAtClearance = (clearance) => {
      const bike = createBike({ x: 0, z: 0 }, terrain);
      bike.v = 8;
      bike.y += clearance;
      bike.airborne = true;
      for (let elapsed = 0; elapsed < 1 && !bike.crashed; elapsed += DT) {
        stepBike(bike, noInput, terrain, [rock], DT);
      }
      return bike;
    };
    expect(bikeAtClearance(1.5).crashed).toBeNull();
    expect(bikeAtClearance(0.4).crashed).toBe('rock');
  });

  it('uses the otter footprint ellipse for up-trail and side collisions', () => {
    const terrain = createPlaneTerrain();
    const otter = {
      type: 'rock',
      x: 0,
      z: 0,
      r: 1,
      hx: 1,
      hz: OTTER_DEPTH_RATIO,
      h: 10,
    };
    const bikeAt = (x, z) => {
      const bike = createBike({ x, z }, terrain);
      bike.v = 8;
      stepBike(bike, noInput, terrain, [otter], DT);
      return bike;
    };

    expect(bikeAt(0, 1).crashed).toBeNull();
    expect(bikeAt(0, 0.6).crashed).toBe('rock');
    expect(bikeAt(1.2, 0).crashed).toBe('rock');
    expect(bikeAt(1.5, 0).crashed).toBeNull();
  });

  it('does not let a flat-ground hop clear the smallest otter', () => {
    const terrain = createPlaneTerrain();
    const otter = {
      type: 'rock',
      x: 0,
      z: -2.5,
      r: 0.6,
      hx: 0.6,
      hz: 0.6 * OTTER_DEPTH_RATIO,
      h: OTTER_HEIGHT_RATIO * 2 * 0.6,
    };
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.v = 10;
    stepBike(bike, { ...noInput, jump: 1 }, terrain, [otter], DT);
    for (let elapsed = 0; elapsed < 1 && !bike.crashed; elapsed += DT) {
      stepBike(bike, noInput, terrain, [otter], DT);
    }
    expect(bike.crashed).toBe('rock');
    expect(otter.h).toBeGreaterThan(0.62);
  });

  it('clears a log with a flat-ground hop at speed', () => {
    const terrain = createPlaneTerrain();
    const log = {
      type: 'log',
      x: 0,
      z: -2.5,
      x1: -1,
      z1: -2.5,
      x2: 1,
      z2: -2.5,
      r: 0.2,
      h: 0.4,
    };
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.v = 10;
    stepBike(bike, { ...noInput, jump: 1 }, terrain, [log], DT);
    for (let elapsed = DT; elapsed < 1 && !bike.crashed; elapsed += DT) {
      stepBike(bike, noInput, terrain, [log], DT);
    }
    expect(bike.crashed).toBeNull();
  });
});

describe('hop on a downhill', () => {
  it('keeps the same short airtime at speed on a steep slope', () => {
    const terrain = createPlaneTerrain(0.3);
    const bike = createBike({ x: 0, z: 0 }, terrain);
    bike.v = 25;
    for (let i = 0; i < 240 && (bike.airborne || i < 12); i += 1) {
      stepBike(bike, noInput, terrain, [], DT);
    }
    expect(bike.airborne).toBe(false);
    expect(bike.v).toBeGreaterThan(15);
    stepBike(bike, { ...noInput, jump: 1 }, terrain, [], DT);
    let air = DT;
    while (bike.airborne && air < 3) {
      stepBike(bike, noInput, terrain, [], DT);
      air += DT;
    }
    expect(bike.crashed).toBeFalsy();
    expect(air).toBeGreaterThan(0.25);
    expect(air).toBeLessThan(0.8);
    expect(airTimeBonus(air)).toBe(0);
  });
});
