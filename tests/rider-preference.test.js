import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RIDER,
  loadRiderPreference,
  saveRiderPreference,
} from '../src/rider-preference.js';

function storageWith(value = null) {
  const values = new Map(value === null ? [] : [['downhill.rider', value]]);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, next) {
      values.set(key, next);
    },
  };
}

describe('rider preference', () => {
  it('defaults invalid stored values to red', () => {
    expect(loadRiderPreference(storageWith('blue'))).toBe(DEFAULT_RIDER);
    expect(loadRiderPreference(storageWith())).toBe(DEFAULT_RIDER);
  });

  it('loads and saves supported riders', () => {
    const storage = storageWith('black');
    expect(loadRiderPreference(storage)).toBe('black');
    expect(saveRiderPreference('red', storage)).toBe('red');
    expect(loadRiderPreference(storage)).toBe('red');
  });
});
