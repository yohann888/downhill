import { CRR_TRAIL, MU_TRAIL } from '../src/physics/constants.js';

export function createPlaneTerrain(grade = 0) {
  return {
    heightAt(_x, z) {
      return grade * z;
    },
    surfaceAt() {
      return { crr: CRR_TRAIL, mu: MU_TRAIL, outOfBounds: false };
    },
    centerX() {
      return 0;
    },
    courseLength: 900,
    halfWidth() {
      return 3;
    },
    checkpoints: [],
    kickers: [],
    finishZ: -900,
  };
}

export function createStepDropTerrain(drop) {
  return {
    heightAt(_x, z) {
      return z <= -20 ? -drop : 0;
    },
    surfaceAt() {
      return { crr: CRR_TRAIL, mu: MU_TRAIL, outOfBounds: false };
    },
    centerX() {
      return 0;
    },
    courseLength: 900,
    halfWidth() {
      return 3;
    },
    checkpoints: [],
    kickers: [],
    finishZ: -900,
  };
}

export function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
