import { obstacleClearance } from './physics/bike.js';

const MAX_LONGITUDINAL_DISTANCE = 2;
const MAX_CLEARANCE = 0.5;
const MIN_SPEED = 15 / 3.6;
const COOLDOWN = 5;
const COMBO_WINDOW = 4;

export function createDodgeTracker() {
  return {
    active: new Map(),
    lastAward: new Map(),
    comboTimes: [],
  };
}

export function updateDodgeTracker(tracker, state, otters, simTime) {
  if (state.crashed) {
    tracker.active.clear();
    tracker.comboTimes = [];
    return [];
  }
  const now = Number(simTime);
  if (!Number.isFinite(now)) return [];

  const nearby = new Set();
  for (const obstacle of otters || []) {
    if (obstacle.type !== 'rock' || !Number.isFinite(obstacle.z)) continue;
    if (Math.abs(obstacle.z - state.z) >= MAX_LONGITUDINAL_DISTANCE) continue;
    nearby.add(obstacle);
    const clearance = obstacleClearance(obstacle, state.x, state.z);
    const track = tracker.active.get(obstacle) || {
      minClearance: clearance,
      maxSpeed: Math.abs(state.v),
    };
    track.minClearance = Math.min(track.minClearance, clearance);
    track.maxSpeed = Math.max(track.maxSpeed, Math.abs(state.v));
    tracker.active.set(obstacle, track);
  }

  const events = [];
  for (const [obstacle, track] of tracker.active) {
    if (nearby.has(obstacle)) continue;
    tracker.active.delete(obstacle);
    const lastAward = tracker.lastAward.get(obstacle) ?? Number.NEGATIVE_INFINITY;
    if (
      track.minClearance > MAX_CLEARANCE
      || track.maxSpeed <= MIN_SPEED
      || now - lastAward < COOLDOWN
    ) continue;
    tracker.lastAward.set(obstacle, now);
    events.push({ type: 'dodge', obstacle, clearance: track.minClearance });
    tracker.comboTimes = tracker.comboTimes.filter((time) => now - time <= COMBO_WINDOW);
    tracker.comboTimes.push(now);
    if (tracker.comboTimes.length >= 3) {
      events.push({ type: 'combo' });
      tracker.comboTimes = [];
    }
  }
  return events;
}
