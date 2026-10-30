export function slowMoTarget(state, heightAboveGround, airTime) {
  return state?.airborne && airTime > 0.35 && heightAboveGround > 2.5 ? 0.4 : 1;
}

export function nextQualityLevel(avgFps, level) {
  return avgFps < 45 && level < 3 ? level + 1 : level;
}

export function airTimeBonus(airTime, heavyLanding = false) {
  if (!Number.isFinite(airTime) || airTime <= 0.8) return 0;
  const bonus = Math.min(3, airTime - 0.5) * (heavyLanding ? 0.5 : 1);
  return Math.round(bonus * 10) / 10;
}
