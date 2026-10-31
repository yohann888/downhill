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

const COURSE_LENGTH = 1200;
const KICKER_S = [180, 390, 610, 835, 1050];
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
    const narrowOne = smoothstep(445, 465, s) * (1 - smoothstep(500, 520, s));
    const narrowTwo = smoothstep(900, 920, s) * (1 - smoothstep(965, 985, s));
    return 3 - 0.8 * Math.max(narrowOne, narrowTwo);
  };

  const baseGrade = (s) => {
    if (s < 40) return 0.1;
    let grade =
      0.21 +
      0.035 * Math.sin(s / 145) +
      0.025 * Math.sin(s / 57 + 1.1) +
      0.012 * Math.sin(s / 23 + 2.4);
    const restOne = smoothstep(300, 320, s) * (1 - smoothstep(385, 405, s));
    const restTwo = smoothstep(760, 780, s) * (1 - smoothstep(845, 865, s));
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
      height +=
        crossProfile(d, hw) +
        mountainNoise(x / 18, z / 18) * mountainAmplitude;
    }
    return height;
  };

  const surfaceAt = (x, z) => {
    const d = Math.abs(x - centerX(z));
    const hw = halfWidth(z);
    const u = Math.max(0, d - hw);
    const t = smoothstep(SHOULDER, SHOULDER + SHOULDER_BLEND, u);
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
    finishZ: -COURSE_LENGTH,
    totalDrop: -profile[COURSE_LENGTH],
  };
}
