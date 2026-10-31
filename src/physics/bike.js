import {
  AIR_EPS,
  BIKE_RADIUS,
  BRAKE_RAMP,
  BOOST_ACCEL,
  CDA,
  COYOTE_TIME,
  G,
  HEAVY_LANDING_VN,
  HOP_SPEED,
  JUMP_BUFFER_TIME,
  LOAD_MAX,
  LOAD_MIN,
  LOAD_PROBE,
  LOAD_TAU,
  M,
  OBSTACLE_CRASH_SPEED,
  PEDAL_FMAX,
  PEDAL_POWER,
  RHO,
  STEER_MAX_LOW,
  STEER_OVERDEMAND,
  STEER_RETURN,
  STEER_SLEW,
  WASHOUT_MIN_SPEED,
  WASHOUT_RATIO,
  WASHOUT_TIME,
  WHEELBASE,
} from './constants.js';
import { COFFEE_TIME, ENERGY_TIME } from '../world/pickups.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function moveToward(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

const decrementTimer = (value, dt) => (value <= dt + 1e-9 ? 0 : value - dt);

function gradeAlongHeading(terrain, x, z, heading) {
  const dx = Math.sin(heading) * 0.5;
  const dz = -Math.cos(heading) * 0.5;
  return (
    terrain.heightAt(x + dx, z + dz) -
    terrain.heightAt(x - dx, z - dz)
  );
}

function closestPointOnObstacle(obstacle, x, z) {
  if (obstacle.type !== 'log') return { x: obstacle.x, z: obstacle.z };

  const dx = obstacle.x2 - obstacle.x1;
  const dz = obstacle.z2 - obstacle.z1;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : clamp(((x - obstacle.x1) * dx + (z - obstacle.z1) * dz) / lengthSquared, 0, 1);

  return {
    x: obstacle.x1 + t * dx,
    z: obstacle.z1 + t * dz,
  };
}

export function createBike({ x, z, heading = 0 }, terrain) {
  const y = terrain.heightAt(x, z);

  return {
    x,
    y,
    z,
    heading,
    v: 0,
    vy: 0,
    airborne: false,
    heavyLanding: false,
    landingImpact: 0,
    steer: 0,
    brake: 0,
    lean: 0,
    slipping: false,
    slipTimer: 0,
    crashed: null,
    aLat: 0,
    aLatSigned: 0,
    aLong: 0,
    gripLimit: null,
    load: 1,
    skid: 0,
    jumpCooldown: 0,
    boostTime: 0,
    boostTarget: 0,
    doubleJumpTime: 0,
    doubleJumpUsed: false,
    doubleJumped: false,
    jumpBuffer: 0,
    jumpHeld: false,
    groundedTimer: 0,
    foliageHit: null,
    foliageTrees: new Set(),
    lastGroundY: y,
  };
}

export function applyPickup(state, type) {
  if (type === 'coffee') {
    state.boostTime = COFFEE_TIME;
    state.boostTarget = clamp(2 * state.v, 16, 36);
  } else if (type === 'energy') {
    state.doubleJumpTime = ENERGY_TIME;
  }
}

export function stepBike(state, input, terrain, obstacles, dt) {
  const airborneAtStart = state.airborne;
  const jumpHeld = Boolean(input.jump);
  const jumpPressed = jumpHeld && !state.jumpHeld;
  state.jumpHeld = jumpHeld;
  state.jumpBuffer = jumpPressed
    ? JUMP_BUFFER_TIME
    : decrementTimer(state.jumpBuffer, dt);
  state.groundedTimer = decrementTimer(state.groundedTimer, dt);
  state.heavyLanding = false;
  state.landingImpact = 0;
  state.skid = 0;
  state.foliageHit = null;
  state.jumpCooldown = Math.max(0, state.jumpCooldown - dt);
  state.boostTime = decrementTimer(state.boostTime, dt);
  state.doubleJumpTime = decrementTimer(state.doubleJumpTime, dt);
  if (state.crashed) {
    state.boostTime = 0;
    return state;
  }

  const surface = terrain.surfaceAt(state.x, state.z);
  const speedForSteering = Math.max(state.v, 1);
  const deltaMax = Math.min(
    STEER_MAX_LOW,
    Math.atan(
      (STEER_OVERDEMAND * (state.gripLimit ?? surface.mu * G) * WHEELBASE) /
        (speedForSteering * speedForSteering),
    ),
  );
  const steerTarget = input.steer * deltaMax;
  state.steer = clamp(
    moveToward(
      state.steer,
      steerTarget,
      (input.steer === 0 ? STEER_RETURN : STEER_SLEW) * dt,
    ),
    -deltaMax,
    deltaMax,
  );

  const brakeRate = input.brake ? 1 / BRAKE_RAMP : 2 / BRAKE_RAMP;
  state.brake = clamp(
    moveToward(state.brake, input.brake, brakeRate * dt),
    0,
    1,
  );

  let groundHop = false;
  if (
    state.jumpBuffer > 0 &&
    (!state.airborne || state.groundedTimer > 0) &&
    state.jumpCooldown <= 0
  ) {
    const grade = gradeAlongHeading(terrain, state.x, state.z, state.heading);
    const verticalBase = state.airborne ? Math.max(state.vy, 0) : state.vy;
    state.vy = verticalBase + HOP_SPEED / Math.sqrt(1 + grade * grade);
    state.jumpCooldown = 0.4;
    state.airborne = true;
    state.jumpBuffer = 0;
    state.groundedTimer = 0;
    groundHop = true;
  } else if (
    jumpPressed &&
    airborneAtStart &&
    state.doubleJumpTime > 0 &&
    !state.doubleJumpUsed &&
    state.jumpCooldown <= 0
  ) {
    state.vy = Math.max(state.vy, 0) + 3.5;
    state.doubleJumpUsed = true;
    state.doubleJumped = true;
    state.jumpCooldown = 0.4;
    state.jumpBuffer = 0;
  }

  if (!state.airborne) {
    const grade = gradeAlongHeading(terrain, state.x, state.z, state.heading);
    const theta = Math.atan(grade);
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const h0 = terrain.heightAt(state.x, state.z);
    const hF = terrain.heightAt(
      state.x + LOAD_PROBE * forwardX,
      state.z + LOAD_PROBE * forwardZ,
    );
    const hB = terrain.heightAt(
      state.x - LOAD_PROBE * forwardX,
      state.z - LOAD_PROBE * forwardZ,
    );
    const curvature =
      ((hF - 2 * h0 + hB) / (LOAD_PROBE * LOAD_PROBE)) /
      (1 + grade * grade) ** 1.5;
    const loadRaw = clamp(
      (G * cosTheta + state.v * state.v * curvature) / (G * cosTheta),
      LOAD_MIN,
      LOAD_MAX,
    );
    state.load += (loadRaw - state.load) * (1 - Math.exp(-dt / LOAD_TAU));

    const rightX = Math.cos(state.heading);
    const rightZ = Math.sin(state.heading);
    const cross =
      (terrain.heightAt(state.x + rightX, state.z + rightZ) -
        terrain.heightAt(state.x - rightX, state.z - rightZ)) /
      2;
    const phi = Math.atan(cross);
    const cosPhi = Math.cos(phi);
    const gRight = -G * Math.sin(phi);
    const grip = surface.mu * G * cosTheta * cosPhi * state.load;
    state.gripLimit = grip;
    const brakeDemand = state.brake * grip;
    const drag = (0.5 * RHO * CDA * state.v * state.v) / M;
    const pedalForce = Math.min(
      PEDAL_FMAX,
      PEDAL_POWER / Math.max(state.v, 0.1),
    );
    const boostAcceleration =
      state.boostTime > 0 && state.v < state.boostTarget && !input.brake
        ? BOOST_ACCEL
        : 0;
    const acceleration =
      -G * sinTheta -
      surface.crr * G * cosTheta * (state.v > 0 ? 1 : 0) -
      drag +
      (input.throttle ? pedalForce / M : 0) -
      brakeDemand +
      boostAcceleration;

    state.aLong = acceleration;
    const aReq = (state.v * state.v * Math.tan(state.steer)) / WHEELBASE;
    const tyreNeed = aReq - gRight;
    const demandedLat = Math.abs(tyreNeed);
    const availableLat = Math.sqrt(Math.max(0, grip * grip - brakeDemand * brakeDemand));
    const lateralRatio = demandedLat / Math.max(availableLat, 1e-6);
    const steerRatio = Math.abs(aReq) / Math.max(availableLat, 1e-6);
    let achieved;

    if (demandedLat > availableLat + 1e-9) {
      state.slipping = true;
      achieved = Math.sign(tyreNeed) * availableLat + gRight;
      if (
        Math.abs(aReq) > availableLat &&
        steerRatio > WASHOUT_RATIO &&
        state.v > WASHOUT_MIN_SPEED
      ) {
        state.slipTimer += dt;
      } else {
        state.slipTimer = Math.max(0, state.slipTimer - 2 * dt);
      }
    } else {
      state.slipping = false;
      achieved = aReq;
      state.slipTimer = Math.max(0, state.slipTimer - 2 * dt);
    }
    state.aLat = Math.abs(achieved);
    state.aLatSigned = achieved;

    const lateralSkid = clamp(
      (lateralRatio - 0.8) / (WASHOUT_RATIO - 0.8),
      0,
      1,
    );
    const brakeGripRatio = brakeDemand / Math.max(grip, 1e-6);
    const brakingSkid = state.v > 3
      ? clamp((brakeGripRatio - 0.85) / 0.15, 0, 1)
      : 0;
    state.skid = Math.max(lateralSkid, brakingSkid);

    if (state.slipTimer > WASHOUT_TIME) state.crashed = 'washout';

    let yawRate;
    if (state.v < 0.5) {
      yawRate = (state.v * Math.tan(state.steer)) / WHEELBASE;
    } else {
      yawRate = achieved / Math.max(state.v, 0.5);
    }
    state.heading += yawRate * dt;

    const oldX = state.x;
    const oldZ = state.z;
    const oldGroundY = terrain.heightAt(oldX, oldZ);
    state.v = Math.max(0, state.v + acceleration * dt);
    state.x += Math.sin(state.heading) * state.v * dt;
    state.z -= Math.cos(state.heading) * state.v * dt;

    const newGroundY = terrain.heightAt(state.x, state.z);
    const groundVy = (newGroundY - oldGroundY) / dt;
    const yCandidate = state.y + state.vy * dt - 0.5 * G * dt * dt;
    if (yCandidate > newGroundY + AIR_EPS) {
      state.airborne = true;
      state.y = yCandidate;
      state.vy -= G * dt;
    } else {
      state.y = newGroundY;
      state.vy = groundVy;
    }
    state.lastGroundY = newGroundY;
  } else {
    state.aLong = -(0.5 * RHO * CDA * state.v * state.v) / M;
    state.aLat = 0;
    state.aLatSigned = 0;
    state.slipping = false;
    state.slipTimer = Math.max(0, state.slipTimer - 2 * dt);
    state.v = Math.max(0, state.v + state.aLong * dt);
    state.x += Math.sin(state.heading) * state.v * dt;
    state.z -= Math.cos(state.heading) * state.v * dt;
    state.vy -= G * dt;
    state.y += state.vy * dt;

    const groundY = terrain.heightAt(state.x, state.z);
    if (state.y <= groundY) {
      const grade = gradeAlongHeading(terrain, state.x, state.z, state.heading);
      const groundSlopeVy = state.v * grade;
      const vn = (state.vy - groundSlopeVy) / Math.sqrt(1 + grade * grade);
      const impactSpeed = -vn;
      state.landingImpact = impactSpeed;
      if (impactSpeed >= HEAVY_LANDING_VN) {
        state.heavyLanding = true;
      }
      state.y = groundY;
      state.vy = groundSlopeVy;
      state.airborne = false;
      state.doubleJumpUsed = false;
      state.doubleJumped = false;
      state.lastGroundY = groundY;
    }
  }

  if (!state.airborne) {
    state.groundedTimer = 0;
  } else if (!airborneAtStart && !groundHop) {
    state.groundedTimer = COYOTE_TIME;
  }

  if (!state.airborne) {
    const targetLean = Math.atan2(state.aLatSigned, G);
    state.lean +=
      (targetLean - state.lean) * (1 - Math.exp(-8 * dt));
  }

  if (terrain.surfaceAt(state.x, state.z).outOfBounds) {
    state.crashed = 'off course';
  }

  if (!state.crashed && obstacles) {
    const currentFoliageTrees = new Set();
    for (const obstacle of obstacles) {
      if (Math.abs(obstacle.z - state.z) >= 6) continue;

      const closest = closestPointOnObstacle(obstacle, state.x, state.z);
      const dx = state.x - closest.x;
      const dz = state.z - closest.z;
      const distance = Math.hypot(dx, dz);
      const hasEllipse = Number.isFinite(obstacle.hx) && Number.isFinite(obstacle.hz);
      const ex = hasEllipse ? obstacle.hx + BIKE_RADIUS : 0;
      const ez = hasEllipse ? obstacle.hz + BIKE_RADIUS : 0;
      const q = hasEllipse ? Math.hypot(dx / ex, dz / ez) : 0;
      const contactDistance =
        obstacle.type === 'tree' ? obstacle.r + 0.2 : BIKE_RADIUS + obstacle.r;

      if (obstacle.type === 'tree') {
        const foliageRadius = Math.min(1.6, obstacle.foliageRadius ?? 0);
        if (distance >= contactDistance && distance < foliageRadius) {
          currentFoliageTrees.add(obstacle);
          if (!state.foliageTrees.has(obstacle)) {
            state.foliageHit = { x: state.x, z: state.z };
          }
          continue;
        }
      }

      if (hasEllipse ? q >= 1 : distance >= contactDistance) continue;
      if (state.y - terrain.heightAt(closest.x, closest.z) >= obstacle.h) continue;

      if (state.v > OBSTACLE_CRASH_SPEED) {
        state.crashed = obstacle.type;
        break;
      }

      if (hasEllipse) {
        if (q <= 1e-9) {
          state.x = closest.x + ex;
          state.z = closest.z;
        } else {
          const k = 1 / Math.max(q, 1e-9);
          state.x = closest.x + dx * k;
          state.z = closest.z + dz * k;
        }
      } else {
        const normalX = distance > 1e-9 ? dx / distance : 1;
        const normalZ = distance > 1e-9 ? dz / distance : 0;
        state.x = closest.x + normalX * contactDistance;
        state.z = closest.z + normalZ * contactDistance;
      }
      state.v = 0;
    }
    state.foliageTrees = currentFoliageTrees;
  } else {
    state.foliageTrees.clear();
  }

  if (state.crashed) state.boostTime = 0;
  if (state.airborne || state.crashed) state.skid = 0;
  return state;
}
