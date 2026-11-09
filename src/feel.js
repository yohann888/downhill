export function slowMoTarget(state, heightAboveGround, airTime) {
  return state?.airborne && airTime > 0.35 && heightAboveGround > 2.5 ? 0.4 : 1;
}

export function nextQualityLevel(avgFps, level) {
  return avgFps < 45 && level < 3 ? level + 1 : level;
}

// Quality 0 sub-steps, cheapest last: trade HiDPI sharpness, then ambient occlusion, before dropping effects.
export const LEVEL0_STEPS = [
  { ratio: 1.5, ao: true },
  { ratio: 1.25, ao: true },
  { ratio: 1, ao: true },
  { ratio: 1, ao: false },
];

export function nextQualityStep(avgFps, level, level0Step, devicePixelRatio) {
  const nextLevel = nextQualityLevel(avgFps, level);
  if (nextLevel !== level && level === 0) {
    const current = LEVEL0_STEPS[level0Step];
    const currentRatio = Math.min(devicePixelRatio, current.ratio);
    const lower = LEVEL0_STEPS.findIndex((step, i) => i > level0Step
      && (Math.min(devicePixelRatio, step.ratio) < currentRatio || (current.ao && !step.ao)));
    if (lower !== -1) return { level, level0Step: lower };
  }
  return { level: nextLevel, level0Step };
}

export function airTimeBonus(airTime) {
  if (!Number.isFinite(airTime) || airTime <= 1) return 0;
  return Math.round(Math.min(6, 1.5 * (airTime - 0.5)) * 10) / 10;
}

export function heightBonus(peak) {
  if (!Number.isFinite(peak) || peak <= 3) return 0;
  return Math.round(Math.min(4, 0.5 * (peak - 3)) * 10) / 10;
}
