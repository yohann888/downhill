import { describe, expect, it } from 'vitest';
import { getMusicGainTarget } from '../src/audio.js';

describe('getMusicGainTarget', () => {
  it('mutes the built-in track when Sound is off', () => {
    expect(getMusicGainTarget(0.25, {
      muted: true,
      selectedMusic: 'music-ride',
      youtubePlaying: false,
    })).toBe(0);
  });

  it('mutes the built-in track while YouTube is playing', () => {
    expect(getMusicGainTarget(0.25, {
      muted: false,
      selectedMusic: 'youtube',
      youtubePlaying: true,
    })).toBe(0);
  });

  it('restores the requested level when YouTube is paused and Sound is on', () => {
    expect(getMusicGainTarget(0.1, {
      muted: false,
      selectedMusic: 'youtube',
      youtubePlaying: false,
    })).toBe(0.1);
  });
});
