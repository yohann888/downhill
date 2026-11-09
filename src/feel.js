export function slowMoTarget(state, heightAboveGround, airTime) {
  return state?.airborne && airTime > 0.35 && heightAboveGround > 2.5 ? 0.4 : 1;
}

export function nextQualityLevel(avgFps, level) {
  return avgFps < 45 && level < 3 ? level + 1 : level;
}

export const LEVEL0_PIXEL_RATIOS = [1.5, 1.25, 1];

// On a slow window, first trade sharpness on HiDPI screens before dropping effects.
export function nextQualityStep(avgFps, level, ratioStep, devicePixelRatio) {
  const nextLevel = nextQualityLevel(avgFps, level);
  if (nextLevel !== level && level === 0) {
    const current = Math.min(devicePixelRatio, LEVEL0_PIXEL_RATIOS[ratioStep]);
    const lower = LEVEL0_PIXEL_RATIOS.findIndex((ratio, i) => i > ratioStep && ratio < current);
    if (lower !== -1) return { level, ratioStep: lower };
  }
  return { level: nextLevel, ratioStep };
}

export function airTimeBonus(airTime) {
  if (!Number.isFinite(airTime) || airTime <= 1) return 0;
  return Math.round(Math.min(6, 1.5 * (airTime - 0.5)) * 10) / 10;
}

export function heightBonus(peak) {
  if (!Number.isFinite(peak) || peak <= 3) return 0;
  return Math.round(Math.min(4, 0.5 * (peak - 3)) * 10) / 10;
}
