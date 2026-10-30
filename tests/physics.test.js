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
import { createPlaneTerrain, createStepDropTerrain } from './helpers.js';

const noInput = { throttle: 0, brake: 0, steer: 0 };

function fallFrom(height, grade, speed) {
  const terrain = createPlaneTerrain(grade);
  const bike = createBike({ x: 0, z: 0 }, terrain);
  bike.y += height;
  bike.airborne = true;
  bike.v = speed;
  for (let elapsed = 0; elapsed < 5 && bike.airborne; elapsed += DT) {
    stepBike(bike, noInput, terrain, [], DT);
  }
  return bike;
}

describe('bike physics', () => {
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

  it('launches from a step drop and distinguishes a hard landing', () => {
    for (const { drop, expectedCrash } of [
      { drop: 1.5, expectedCrash: null },
      { drop: 7, expectedCrash: 'hard landing' },
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
      expect(bike.crashed).toBe(expectedCrash);
      if (drop === 1.5) {
        expect(bike.airborne).toBe(false);
      }
    }
  });

  it('scrubs speed on a medium-hard 4m flat landing without crashing', () => {
    const bike = fallFrom(4, 0, 10);

    expect(bike.airborne).toBe(false);
    expect(bike.crashed).toBeNull();
    expect(bike.heavyLanding).toBe(true);
    expect(bike.landingImpact).toBeCloseTo(Math.sqrt(2 * G * 4), 0);
    expect(bike.v).toBeLessThan(10);

    stepBike(bike, noInput, createPlaneTerrain(), [], DT);
    expect(bike.heavyLanding).toBe(false);
    expect(bike.landingImpact).toBe(0);
  });

  it('crashes on a 7m fall onto flat ground', () => {
    const bike = fallFrom(7, 0, 10);

    expect(bike.airborne).toBe(false);
    expect(bike.crashed).toBe('hard landing');
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
});
