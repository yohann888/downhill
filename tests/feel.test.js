import { describe, expect, it } from 'vitest';
import {
  airTimeBonus,
  heightBonus,
  nextQualityLevel,
  slowMoTarget,
} from '../src/feel.js';

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

describe('airTimeBonus', () => {
  it('awards larger rounded bonuses for big air only above the threshold', () => {
    expect(airTimeBonus(0.8)).toBe(0);
    expect(airTimeBonus(1.0)).toBe(0.8);
    expect(airTimeBonus(2.0)).toBe(2.3);
    expect(airTimeBonus(5.0)).toBe(6.0);
    expect(airTimeBonus(Number.NaN)).toBe(0);
    expect(airTimeBonus(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('heightBonus', () => {
  it('awards a capped bonus for jumps above 3 metres', () => {
    expect(heightBonus(2)).toBe(0);
    expect(heightBonus(3)).toBe(0);
    expect(heightBonus(5)).toBe(1);
    expect(heightBonus(11)).toBe(4);
    expect(heightBonus(20)).toBe(4);
    expect(heightBonus(Number.NaN)).toBe(0);
  });
});
