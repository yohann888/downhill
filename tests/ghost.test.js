import { describe, expect, it } from 'vitest';
import { createRecorder, sampleGhost } from '../src/ghost.js';

describe('ghost recording and playback', () => {
  it('records at simulation intervals and rounds frames to two decimals', () => {
    const recorder = createRecorder();
    recorder.sample(0, { x: 0, y: 1, z: 0, heading: 0, lean: 0 });
    recorder.sample(0.05, { x: 1, y: 1, z: -1, heading: 0, lean: 0 });
    recorder.sample(0.1, { x: 2, y: 1.234, z: -2, heading: 0.2, lean: 0.1 });

    expect(recorder.getGhost()).toEqual({
      dt: 0.1,
      frames: [
        [0, 1, 0, 0, 0],
        [2, 1.23, -2, 0.2, 0.1],
      ],
    });
  });

  it('resets its samples and interpolates the shortest heading angle', () => {
    const recorder = createRecorder(0.1);
    recorder.sample(0, { x: 0, y: 0, z: 0, heading: 3.1, lean: 0 });
    recorder.sample(0.1, { x: 1, y: 2, z: 3, heading: -3.1, lean: 1 });
    const mid = sampleGhost(recorder.getGhost(), 0.05);

    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(1);
    expect(Math.abs(mid.heading)).toBeCloseTo(Math.PI, 1);
    expect(sampleGhost(recorder.getGhost(), 0.11)).toBeNull();

    recorder.reset();
    expect(recorder.getGhost().frames).toEqual([]);
  });
});
