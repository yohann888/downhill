import {
  CRR_OFF,
  CRR_TRAIL,
  MU_OFF,
  MU_TRAIL,
  OUT_OF_BOUNDS,
  SHOULDER,
  SHOULDER_BLEND,
} from '../physics/constants.js';
import { createValueNoise } from './noise.js';

const S = 0.75;
const COURSE_LENGTH = 1200 * S;
const KICKER_S = [180, 390, 610, 835, 1050].map((s) => s * S);
const KICKER_HEIGHT = 1.2;

const smoothstep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Mountainside traverse: uphill wall on the left (-x), berm then drop-off on the right (+x).
export function crossProfile(d, hw) {
  const u = Math.max(0, Math.abs(d) - hw);
  if (d < 0) return 0.12 * Math.min(u, 5) ** 2 + 0.45 * Math.max(0, u - 5);
  return 0.12 * Math.min(u, 2) ** 2 - 0.3 * Math.max(0, u - 2);
}

export function createTerrain(seed = 1) {
  const trailNoise = createValueNoise(seed);
  const mountainNoise = createValueNoise(seed ^ 0x9e3779b9);
  const kickers = KICKER_S.map((s) => ({
    s,
    z: -s,
    height: KICKER_HEIGHT,
  }));
  const centerX = (z) =>
    18 * Math.sin(z / 90) +
    9 * Math.sin(z / 37 + 1.3) +
    4 * Math.sin(z / 17 + 0.4);

  const halfWidth = (z) => {
    const s = -z;
    const narrowOne = smoothstep(445 * S, 465 * S, s) * (1 - smoothstep(500 * S, 520 * S, s));
    const narrowTwo = smoothstep(900 * S, 920 * S, s) * (1 - smoothstep(965 * S, 985 * S, s));
    return 3 - 0.8 * Math.max(narrowOne, narrowTwo);
  };

  const returnPaths = [];
  let pathIndex = 0;
  for (let s0 = 60; s0 <= COURSE_LENGTH - 60; s0 += 90) {
    const side = pathIndex % 2 === 0 ? 1 : -1;
    pathIndex += 1;
    const joinStart = s0 + 45 - 15;
    const joinEnd = s0 + 45 + 5;
    if (kickers.some((kicker) => kicker.s >= joinStart && kicker.s <= joinEnd)) {
      continue;
    }
    returnPaths.push({ s0, side, L: 45, U0: 16, PW: 1.1, PB: 1.5 });
  }

  const baseGrade = (s) => {
    if (s < 40 * S) return 0.1;
    let grade =
      0.21 +
      0.035 * Math.sin(s / 145) +
      0.025 * Math.sin(s / 57 + 1.1) +
      0.012 * Math.sin(s / 23 + 2.4);
    const restOne = smoothstep(300 * S, 320 * S, s) * (1 - smoothstep(385 * S, 405 * S, s));
    const restTwo = smoothstep(760 * S, 780 * S, s) * (1 - smoothstep(845 * S, 865 * S, s));
    const rest = Math.max(restOne, restTwo);
    grade += (0.06 - grade) * rest;

    let landing = 0;
    for (const kicker of kickers) {
      const blend =
        smoothstep(kicker.s - 1, kicker.s + 1, s) *
        (1 - smoothstep(kicker.s + 9, kicker.s + 11, s));
      landing = Math.max(landing, blend);
    }
    return grade + (0.3 - grade) * landing;
  };

  const profile = new Float64Array(COURSE_LENGTH + 1);
  for (let index = 1; index <= COURSE_LENGTH; index += 1) {
    profile[index] = profile[index - 1] - baseGrade(index - 0.5);
  }

  const profileAt = (s) => {
    if (s < 0) return -0.1 * s;
    if (s > COURSE_LENGTH) {
      return profile[COURSE_LENGTH] - (s - COURSE_LENGTH) * baseGrade(COURSE_LENGTH);
    }
    const lower = Math.floor(s);
    const fraction = s - lower;
    if (lower === COURSE_LENGTH) return profile[COURSE_LENGTH];
    return profile[lower] + (profile[lower + 1] - profile[lower]) * fraction;
  };

  const pathOffsetAt = (path, s) =>
    path.U0 * (1 - smoothstep(path.s0, path.s0 + path.L, s));

  const pathAt = (x, z) => {
    const s = -z;
    const d = x - centerX(z);
    const hw = halfWidth(z);
    const u = Math.abs(d) - hw;
    if (u <= 0) return null;

    let best = null;
    for (const path of returnPaths) {
      if (s < path.s0 - 10 || s > path.s0 + path.L || Math.sign(d) !== path.side) {
        continue;
      }
      const offset = pathOffsetAt(path, s);
      const fade = smoothstep(path.s0 - 10, path.s0, s);
      const weight =
        fade *
        (1 - smoothstep(path.PW, path.PW + path.PB, Math.abs(u - offset)));
      if (!best || weight > best.weight) {
        best = {
          weight,
          bench: profileAt(s) + crossProfile(path.side * (hw + offset), hw),
        };
      }
    }
    return best && best.weight > 0 ? best : null;
  };

  const pathWeightAt = (x, z) => pathAt(x, z)?.weight ?? 0;

  const heightAt = (x, z) => {
    const s = -z;
    const cx = centerX(z);
    const d = x - cx;
    const hw = halfWidth(z);
    let height = profileAt(s);

    if (Math.abs(d) <= hw) {
      for (const kicker of kickers) {
        if (s >= kicker.s - 6 && s < kicker.s) {
          height += kicker.height * smoothstep(kicker.s - 6, kicker.s, s);
        }
      }
      height += trailNoise(x / 3, z / 3) * 0.08;
    } else {
      const distanceOutside = Math.abs(d) - hw;
      const mountainAmplitude = Math.min(8, distanceOutside * 0.14);
      const rough =
        height +
        crossProfile(d, hw) +
        mountainNoise(x / 18, z / 18) * mountainAmplitude;
      const path = pathAt(x, z);
      height = path ? rough + (path.bench - rough) * path.weight : rough;
    }
    return height;
  };

  const surfaceAt = (x, z) => {
    const d = Math.abs(x - centerX(z));
    const hw = halfWidth(z);
    const u = Math.max(0, d - hw);
    const t =
      pathWeightAt(x, z) >= 0.5
        ? 0
        : smoothstep(SHOULDER, SHOULDER + SHOULDER_BLEND, u);
    return {
      crr: CRR_TRAIL + (CRR_OFF - CRR_TRAIL) * t,
      mu: MU_TRAIL + (MU_OFF - MU_TRAIL) * t,
      outOfBounds:
        d > hw + OUT_OF_BOUNDS || z < -COURSE_LENGTH - 30 || z > 20,
    };
  };

  const checkpoints = [];
  for (let s = 150; s <= COURSE_LENGTH; s += 150) {
    const z = -s;
    const dxDs = centerX(z - 0.5) - centerX(z + 0.5);
    checkpoints.push({
      s,
      z,
      x: centerX(z),
      heading: Math.atan2(dxDs, 1),
    });
  }

  return {
    heightAt,
    surfaceAt,
    centerX,
    courseLength: COURSE_LENGTH,
    halfWidth,
    checkpoints,
    kickers,
    returnPaths,
    pathWeightAt,
    finishZ: -COURSE_LENGTH,
    totalDrop: -profile[COURSE_LENGTH],
  };
}
