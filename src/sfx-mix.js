const clamp01 = (value) => Math.min(1, Math.max(0, value));

export const WHOOSH_RANGE = 4.5;
export const WHOOSH_MIN_SPEED = 7;

export function landingSound(impact) {
  const heavy = clamp01((impact - 3) / 8);
  return {
    volume: 0.45 + heavy * 0.55,
    rate: 1.08 - heavy * 0.22,
    thump: heavy > 0.35 ? (heavy - 0.35) / 0.65 : 0,
    send: 0.08 + heavy * 0.22,
  };
}

export function crashVariant(random = Math.random) {
  return {
    rate: 0.88 + random() * 0.24,
    offset: random() * 0.12,
    send: 0.18 + random() * 0.14,
  };
}

export function sortTreesByZ(obstacles) {
  return obstacles
    .filter((obstacle) => obstacle.type === 'tree')
    .map((tree) => ({ x: tree.x, z: tree.z }))
    .sort((a, b) => a.z - b.z);
}

function firstIndexAbove(trees, z) {
  let lo = 0;
  let hi = trees.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trees[mid].z <= z) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function treePasses(trees, prevZ, z, x, speed) {
  if (speed < WHOOSH_MIN_SPEED || z >= prevZ || prevZ - z > 10) return [];
  const passes = [];
  const speed01 = clamp01((speed - WHOOSH_MIN_SPEED) / 13);
  for (let i = firstIndexAbove(trees, z); i < trees.length && trees[i].z <= prevZ; i += 1) {
    const dx = trees[i].x - x;
    const distance = Math.abs(dx);
    if (distance > WHOOSH_RANGE) continue;
    const near = 1 - distance / WHOOSH_RANGE;
    passes.push({
      pan: Math.max(-0.9, Math.min(0.9, dx / 2.5)),
      volume: 0.12 + 0.38 * near * (0.4 + 0.6 * speed01),
      rate: 0.85 + speed01 * 0.4,
    });
  }
  return passes;
}

export function offTrailAmount(terrain, x, z) {
  const outside = Math.abs(x - terrain.centerX(z)) - terrain.halfWidth(z);
  return clamp01(outside / 1.5) * (1 - clamp01(terrain.pathWeightAt?.(x, z) ?? 0));
}

export function tireMix(level, offTrail) {
  const off = clamp01(offTrail);
  return {
    gravel: level * 0.6 * (1 - off),
    dirt: level * 0.65 * (1 - off),
    grass: level * 0.95 * off,
  };
}

export function pickTake(takes, last, random = Math.random) {
  const fresh = takes.length > 1 ? takes.filter((take) => take !== last) : takes;
  return fresh[Math.floor(random() * fresh.length)] ?? last;
}
