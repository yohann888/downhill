import { createRandom } from './noise.js';

function inKickerExclusion(s, kickers) {
  return kickers.some((kicker) => s >= kicker.s - 25 && s <= kicker.s + 15);
}

export function createObstacles(terrain, seed = 7) {
  const random = createRandom(seed);
  const obstacles = [];

  for (const side of [-1, 1]) {
    for (let s = 70; s <= terrain.courseLength - 40; s += 18 + random() * 12) {
      const z = -s;
      const hw = terrain.halfWidth(z);
      const x =
        terrain.centerX(z) + side * (hw + 0.7 + random() * 5.5);
      obstacles.push({
        type: 'tree',
        x,
        z,
        r: 0.4 + random() * 0.15,
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
      type === 'rock' ? 0.4 + random() * 0.5 : type === 'stump' ? 0.3 : 0.2;
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
      h: type === 'rock' ? 0.4 + random() * 0.5 : type === 'stump' ? 0.5 : 0.4,
      rot: random() * Math.PI * 2,
    };

    if (type === 'log') {
      const halfLength = length / 2;
      obstacle.x1 = x - halfLength;
      obstacle.z1 = z + (random() - 0.5) * 0.2;
      obstacle.x2 = x + halfLength;
      obstacle.z2 = z - (random() - 0.5) * 0.2;
    }
    obstacles.push(obstacle);
  }

  return obstacles.sort((a, b) => b.z - a.z);
}
