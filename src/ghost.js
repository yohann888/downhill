function rounded(value) {
  return Math.round(value * 100) / 100;
}

function angleDifference(from, to) {
  return ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function lerpFrame(a, b, alpha) {
  return [
    a[0] + (b[0] - a[0]) * alpha,
    a[1] + (b[1] - a[1]) * alpha,
    a[2] + (b[2] - a[2]) * alpha,
    a[3] + angleDifference(a[3], b[3]) * alpha,
    a[4] + (b[4] - a[4]) * alpha,
  ];
}

function frameFromBike(bike) {
  return [bike.x, bike.y, bike.z, bike.heading, bike.lean];
}

export function createRecorder(dt = 0.1) {
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('dt must be positive and finite');
  let frames = [];
  let previousTime = null;
  let previousFrame = null;
  let nextSampleTime = null;

  return {
    reset() {
      frames = [];
      previousTime = null;
      previousFrame = null;
      nextSampleTime = null;
    },
    sample(simTime, bike) {
      if (!Number.isFinite(simTime)) return;
      const currentFrame = frameFromBike(bike);
      if (previousTime === null || simTime < previousTime) {
        frames = [currentFrame.map(rounded)];
        previousTime = simTime;
        previousFrame = currentFrame;
        nextSampleTime = simTime + dt;
        return;
      }
      while (nextSampleTime <= simTime) {
        const span = simTime - previousTime;
        const alpha = span > 0 ? (nextSampleTime - previousTime) / span : 1;
        frames.push(lerpFrame(previousFrame, currentFrame, alpha).map(rounded));
        nextSampleTime += dt;
      }
      previousTime = simTime;
      previousFrame = currentFrame;
    },
    getGhost() {
      return { dt, frames: frames.map((frame) => [...frame]) };
    },
  };
}

export function sampleGhost(ghost, time) {
  if (!ghost || !Number.isFinite(time) || time < 0 || !ghost.dt || !ghost.frames?.length) {
    return null;
  }
  const framePosition = time / ghost.dt;
  const lastIndex = ghost.frames.length - 1;
  if (framePosition > lastIndex) return null;
  const lowerIndex = Math.floor(framePosition);
  const upperIndex = Math.min(lowerIndex + 1, lastIndex);
  const values = lerpFrame(
    ghost.frames[lowerIndex],
    ghost.frames[upperIndex],
    framePosition - lowerIndex,
  );
  return {
    x: values[0],
    y: values[1],
    z: values[2],
    heading: values[3],
    lean: values[4],
  };
}
