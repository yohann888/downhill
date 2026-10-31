export const PICKUP_RADIUS = 1.3;
export const PICKUP_REACH = 3;
export const COFFEE_TIME = 8;
export const ENERGY_TIME = 30;

const PICKUP_LAYOUT = [
  { type: 'energy', fraction: 0.1 },
  { type: 'coffee', fraction: 0.29 },
  { type: 'energy', fraction: 0.48 },
  { type: 'coffee', fraction: 0.66 },
];

export function createPickups(terrain, obstacles) {
  const nonTreeObstacles = obstacles.filter((obstacle) => obstacle.type !== 'tree');

  const isClear = (candidateS) => {
    const z = -candidateS;
    const nearKicker = terrain.kickers.some(
      (kicker) =>
        candidateS >= kicker.s - 25 && candidateS <= kicker.s + 15,
    );
    const nearObstacle = nonTreeObstacles.some(
      (obstacle) => Math.abs(obstacle.z - z) < 6,
    );
    return !nearKicker && !nearObstacle;
  };

  return PICKUP_LAYOUT.map(({ type, fraction }) => {
    const desiredS = terrain.courseLength * fraction;
    let s = null;

    for (let offset = 0; offset <= 40; offset += 2) {
      const candidateS = desiredS + offset;
      if (isClear(candidateS)) {
        s = candidateS;
        break;
      }
    }

    if (s === null) {
      for (let offset = 2; offset <= 40; offset += 2) {
        const candidateS = desiredS - offset;
        if (isClear(candidateS)) {
          s = candidateS;
          break;
        }
      }
    }

    if (s === null) {
      throw new Error(`No clear ${type} pickup location near s=${desiredS}`);
    }

    const z = -s;
    return {
      type,
      x: terrain.centerX(z),
      z,
      s,
      taken: false,
    };
  });
}
