const STORAGE_KEY = 'downhill.splits.v1';

export function splitDelta(runTime, bestTime) {
  const current = Number(runTime);
  const best = Number(bestTime);
  return Number.isFinite(current) && Number.isFinite(best) ? current - best : null;
}

export function ghostTimeAtZ(ghost, checkpointZ) {
  const frames = ghost?.frames;
  const dt = Number(ghost?.dt);
  const z = Number(checkpointZ);
  if (!Array.isArray(frames) || !frames.length || !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(z)) {
    return null;
  }
  if (!Array.isArray(frames[0]) || Number(frames[0][2]) <= z) return 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previousZ = Number(frames[index - 1]?.[2]);
    const currentZ = Number(frames[index]?.[2]);
    if (!Number.isFinite(previousZ) || !Number.isFinite(currentZ)) return null;
    if (previousZ > z && currentZ <= z) {
      const fraction = (previousZ - z) / (previousZ - currentZ);
      return (index - 1 + fraction) * dt;
    }
  }
  return null;
}

export function loadBestSplits(storage, checkpointCount) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY));
    if (
      stored?.count !== checkpointCount
      || !Array.isArray(stored.times)
      || stored.times.length !== checkpointCount
      || stored.times.some((time) => typeof time !== 'number' || !Number.isFinite(time))
    ) return null;
    return stored.times.map(Number);
  } catch {
    return null;
  }
}

export function saveBestSplits(storage, checkpointCount, times) {
  if (
    !Array.isArray(times)
    || times.length !== checkpointCount
    || times.some((time) => typeof time !== 'number' || !Number.isFinite(time))
  ) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      count: checkpointCount,
      times: times.map(Number),
    }));
    return true;
  } catch {
    return false;
  }
}
