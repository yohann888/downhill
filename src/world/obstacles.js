import { createRandom } from './noise.js';

const TREE_TRUNK_RADII = [0.32, 0.15];
const TREE_CANOPY_RADII = [2.64, 2];
export const OTTER_HEIGHT_RATIO = 0.629841;
export const OTTER_DEPTH_RATIO = 13289 / 32767;

const smoothstep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function inKickerExclusion(s, kickers) {
  return kickers.some((kicker) => s >= kicker.s - 25 && s <= kicker.s + 15);
}

export function updateMovingObstacles(obstacles, t) {
  for (const obstacle of obstacles) {
    if (!obstacle.walk) continue;
    const angle = t * obstacle.walk.speed + obstacle.walk.phase;
    obstacle.x = obstacle.baseX + obstacle.walk.amp * Math.sin(angle);
    obstacle.dir = Math.sign(Math.cos(angle)) || 1;
  }
}

export function createObstacles(terrain, seed = 7) {
  const random = createRandom(seed);
  const treeScaleRandom = createRandom(41);
  const obstacles = [];
  let treeIndex = 0;

  for (const side of [-1, 1]) {
    for (let s = 70; s <= terrain.courseLength - 40; s += 18 + random() * 12) {
      const z = -s;
      const hw = terrain.halfWidth(z);
      const x =
        terrain.centerX(z) + side * (hw + 0.7 + random() * 5.5);
      random();
      obstacles.push({
        type: 'tree',
        x,
        z,
        h: 10,
        rot: random() * Math.PI * 2,
      });
    }
  }

  for (let s = 60; s <= terrain.courseLength - 30; ) {
    const density = (s - 60) / (terrain.courseLength - 90);
    const meanSpacing = 40 - density * 25;
    s += meanSpacing * (0.65 + random() * 0.7);
    if (s > terrain.courseLength - 30) break;
    if (inKickerExclusion(s, terrain.kickers)) continue;

    const z = -s;
    const hw = terrain.halfWidth(z);
    const types = ['rock', 'stump', 'log'];
    const type = types[Math.floor(random() * types.length)];
    const r =
      type === 'rock'
        ? (0.4 + random() * 0.5) * 1.5
        : type === 'stump'
          ? 0.3
          : 0.2;
    const length = type === 'log' ? 1 + random() * 0.8 : 0;
    const minOffset = Math.max(0, 1.6 + r + length / 2 - hw);
    const maxOffset = Math.max(
      minOffset,
      hw - r - length / 2 - 0.15,
    );
    const offset = minOffset + random() * (maxOffset - minOffset);
    const d = (random() < 0.5 ? -1 : 1) * offset;
    const x = terrain.centerX(z) + d;
    const obstacle = {
      type,
      x,
      z,
      r,
      h:
        type === 'rock'
          ? OTTER_HEIGHT_RATIO * 2 * Math.max(r, 0.4)
          : type === 'stump'
            ? 0.5
            : 0.4,
      rot: random() * Math.PI * 2,
    };

    if (type === 'rock') {
      const extent = Math.max(r, 0.4);
      obstacle.hx = extent;
      obstacle.hz = extent * OTTER_DEPTH_RATIO;
    }

    if (type === 'log') {
      const halfLength = length / 2;
      obstacle.x1 = x - halfLength;
      obstacle.z1 = z + (random() - 0.5) * 0.2;
      obstacle.x2 = x + halfLength;
      obstacle.z2 = z - (random() - 0.5) * 0.2;
    }
    obstacles.push(obstacle);
  }

  obstacles.sort((a, b) => b.z - a.z);
  for (const obstacle of obstacles) {
    if (obstacle.type !== 'tree') continue;
    const treeVariant = treeIndex % TREE_TRUNK_RADII.length;
    treeIndex += 1;
    obstacle.treeScale = 0.9 + treeScaleRandom() * 0.5;
    obstacle.treeVariant = treeVariant;
    obstacle.r = TREE_TRUNK_RADII[treeVariant] * obstacle.treeScale;
    obstacle.foliageRadius = Math.min(
      1.6,
      TREE_CANOPY_RADII[treeVariant] * obstacle.treeScale,
    );
  }

  const outerTreeRandom = createRandom(seed ^ 0x5bd1e995);
  for (const side of [-1, 1]) {
    for (let s = 70; s <= terrain.courseLength - 40; ) {
      const z = -s;
      const hw = terrain.halfWidth(z);
      const x = terrain.centerX(z) + side * (hw + 7 + outerTreeRandom() * 15);
      const onPath = terrain.pathWeightAt(x, z) > 0;
      const nearPathCenterline = terrain.returnPaths.some((path) => {
        if (path.side !== side || s < path.s0 - 10 || s > path.s0 + path.L) {
          return false;
        }
        const offset =
          path.U0 *
          (1 - smoothstep(path.s0, path.s0 + path.L, s));
        const pathX = terrain.centerX(z) + side * (hw + offset);
        return Math.abs(x - pathX) < 3;
      });

      if (!onPath && !nearPathCenterline) {
        const treeVariant = Math.floor(outerTreeRandom() * TREE_TRUNK_RADII.length);
        const treeScale = 0.9 + outerTreeRandom() * 0.5;
        obstacles.push({
          type: 'tree',
          x,
          z,
          h: 10,
          rot: outerTreeRandom() * Math.PI * 2,
          treeScale,
          treeVariant,
          r: TREE_TRUNK_RADII[treeVariant] * treeScale,
          foliageRadius: Math.min(
            1.6,
            TREE_CANOPY_RADII[treeVariant] * treeScale,
          ),
        });
      }
      s += 12 + outerTreeRandom() * 10;
    }
  }

  for (const obstacle of obstacles) {
    if (obstacle.type !== 'rock') continue;
    const center = terrain.centerX(obstacle.z);
    const halfWidth = terrain.halfWidth(obstacle.z);
    const minX = center - halfWidth + obstacle.r + 0.3;
    const maxX = center + halfWidth - obstacle.r - 0.3;
    const range = maxX - minX;
    const amp = range > 0 ? range / 2 : 0;
    obstacle.baseX = (minX + maxX) / 2;
    obstacle.walk = {
      amp,
      speed: 0.9 / Math.max(amp, 0.5),
      phase: random() * Math.PI * 2,
    };
  }
  obstacles.sort((a, b) => b.z - a.z);
  updateMovingObstacles(obstacles, 0);
  return obstacles;
}
