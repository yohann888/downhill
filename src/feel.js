export function slowMoTarget(state, heightAboveGround, airTime) {
  return state?.airborne && airTime > 0.35 && heightAboveGround > 2.5 ? 0.4 : 1;
}

export function nextQualityLevel(avgFps, level) {
  return avgFps < 45 && level < 3 ? level + 1 : level;
}
