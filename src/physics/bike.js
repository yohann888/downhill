import {
  AIR_EPS,
  BIKE_RADIUS,
  BRAKE_RAMP,
  CDA,
  G,
  HARD_LANDING_VN,
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function moveToward(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

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
    steer: 0,
    brake: 0,
    lean: 0,
    slipping: false,
    slipTimer: 0,
    crashed: null,
    aLat: 0,
    aLong: 0,
    lastGroundY: y,
  };
}

export function stepBike(state, input, terrain, obstacles, dt) {
  if (state.crashed) return state;

  const surface = terrain.surfaceAt(state.x, state.z);
  const speedForSteering = Math.max(state.v, 1);
  const deltaMax = Math.min(
    STEER_MAX_LOW,
    Math.atan(
      (STEER_OVERDEMAND * surface.mu * G * WHEELBASE) /
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

  if (!state.airborne) {
    const grade = gradeAlongHeading(terrain, state.x, state.z, state.heading);
    const theta = Math.atan(grade);
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const grip = surface.mu * G * cosTheta;
    const brakeDemand = state.brake * grip;
    const drag = (0.5 * RHO * CDA * state.v * state.v) / M;
    const pedalForce = Math.min(
      PEDAL_FMAX,
      PEDAL_POWER / Math.max(state.v, 0.1),
    );
    const acceleration =
      -G * sinTheta -
      surface.crr * G * cosTheta * (state.v > 0 ? 1 : 0) -
      drag +
      (input.throttle ? pedalForce / M : 0) -
      brakeDemand;

    state.aLong = acceleration;
    const demandedLat = (state.v * state.v * Math.tan(Math.abs(state.steer))) / WHEELBASE;
    const availableLat = Math.sqrt(Math.max(0, grip * grip - brakeDemand * brakeDemand));

    if (demandedLat > availableLat + 1e-9) {
      state.slipping = true;
      state.aLat = availableLat;
      const ratio = demandedLat / Math.max(availableLat, 1e-6);
      if (ratio > WASHOUT_RATIO && state.v > WASHOUT_MIN_SPEED) {
        state.slipTimer += dt;
      } else {
        state.slipTimer = Math.max(0, state.slipTimer - 2 * dt);
      }
    } else {
      state.slipping = false;
      state.aLat = demandedLat;
      state.slipTimer = Math.max(0, state.slipTimer - 2 * dt);
    }

    if (state.slipTimer > WASHOUT_TIME) state.crashed = 'washout';

    let yawRate;
    if (state.v < 0.5) {
      yawRate = (state.v * Math.tan(state.steer)) / WHEELBASE;
    } else {
      yawRate =
        (Math.sign(state.steer) * state.aLat) / Math.max(state.v, 0.5);
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
      if (state.vy - groundSlopeVy < -HARD_LANDING_VN) {
        state.crashed = 'hard landing';
      }
      state.y = groundY;
      state.vy = groundSlopeVy;
      state.airborne = false;
      state.lastGroundY = groundY;
    }
  }

  if (!state.airborne) {
    const targetLean = Math.atan2(state.aLat * Math.sign(state.steer), G);
    state.lean +=
      (targetLean - state.lean) * (1 - Math.exp(-8 * dt));
  }

  if (terrain.surfaceAt(state.x, state.z).outOfBounds) {
    state.crashed = 'off course';
  }

  if (!state.crashed && obstacles) {
    for (const obstacle of obstacles) {
      if (Math.abs(obstacle.z - state.z) >= 6) continue;

      const closest = closestPointOnObstacle(obstacle, state.x, state.z);
      const dx = state.x - closest.x;
      const dz = state.z - closest.z;
      const distance = Math.hypot(dx, dz);
      const contactDistance = BIKE_RADIUS + obstacle.r;

      if (distance >= contactDistance) continue;
      if (state.y - terrain.heightAt(closest.x, closest.z) >= obstacle.h) continue;

      if (state.v > OBSTACLE_CRASH_SPEED) {
        state.crashed = obstacle.type;
        break;
      }

      const normalX = distance > 1e-9 ? dx / distance : 1;
      const normalZ = distance > 1e-9 ? dz / distance : 0;
      state.x = closest.x + normalX * contactDistance;
      state.z = closest.z + normalZ * contactDistance;
      state.v = 0;
    }
  }

  return state;
}
