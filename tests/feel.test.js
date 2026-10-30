import { describe, expect, it } from 'vitest';
import { nextQualityLevel, slowMoTarget } from '../src/feel.js';

describe('slowMoTarget', () => {
  it('slows only during sufficiently high, sustained airtime', () => {
    expect(slowMoTarget({ airborne: true }, 2.6, 0.36)).toBe(0.4);
    expect(slowMoTarget({ airborne: false }, 3, 1)).toBe(1);
    expect(slowMoTarget({ airborne: true }, 2.5, 1)).toBe(1);
    expect(slowMoTarget({ airborne: true }, 3, 0.35)).toBe(1);
  });
});

describe('nextQualityLevel', () => {
  it('steps down only below 45 FPS and never passes level 3', () => {
    expect(nextQualityLevel(44.9, 0)).toBe(1);
    expect(nextQualityLevel(45, 0)).toBe(0);
    expect(nextQualityLevel(30, 2)).toBe(3);
    expect(nextQualityLevel(10, 3)).toBe(3);
  });
});
