export function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function createValueNoise(seed = 1) {
  const random = createRandom(seed);
  const permutation = Array.from({ length: 256 }, (_, index) => index);
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [permutation[index], permutation[swapIndex]] = [
      permutation[swapIndex],
      permutation[index],
    ];
  }

  const smooth = (value) => value * value * (3 - 2 * value);
  const lattice = (x, y) => {
    const wrappedX = ((x % 256) + 256) % 256;
    const wrappedY = ((y % 256) + 256) % 256;
    return permutation[(permutation[wrappedX] + wrappedY) % 256] / 127.5 - 1;
  };

  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const top = lattice(x0, y0) * (1 - tx) + lattice(x0 + 1, y0) * tx;
    const bottom =
      lattice(x0, y0 + 1) * (1 - tx) + lattice(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}
