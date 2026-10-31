export function slowMoTarget(state, heightAboveGround, airTime) {
  return state?.airborne && airTime > 0.35 && heightAboveGround > 2.5 ? 0.4 : 1;
}

export function nextQualityLevel(avgFps, level) {
  return avgFps < 45 && level < 3 ? level + 1 : level;
}

export function airTimeBonus(airTime) {
  if (!Number.isFinite(airTime) || airTime <= 1) return 0;
  return Math.round(Math.min(6, 1.5 * (airTime - 0.5)) * 10) / 10;
}

export function heightBonus(peak) {
  if (!Number.isFinite(peak) || peak <= 3) return 0;
  return Math.round(Math.min(4, 0.5 * (peak - 3)) * 10) / 10;
}
