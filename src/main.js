import * as THREE from 'three';
import { createBike, stepBike } from './physics/bike.js';
import { DT } from './physics/constants.js';
import { createObstacles } from './world/obstacles.js';
import { createTerrain } from './world/terrain.js';
import { buildWorld } from './render/world.js';
import { createRiderModel } from './render/rider.js';
import { createDust } from './render/dust.js';
import { createAudio } from './audio.js';
import { loadModels } from './render/assets.js';
import { createPost } from './render/post.js';
import { nextQualityLevel, slowMoTarget } from './feel.js';

const CRASH_PENALTY = 3;
const RESPAWN_DELAY = 1.6;
const queryParams = new URLSearchParams(window.location.search);
const qualityMode = queryParams.get('quality');
const initialQuality = qualityMode === 'low' ? 3 : 0;
const autoQualityEnabled = qualityMode !== 'high';
const debug = queryParams.has('debug');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(
  initialQuality >= 3 ? 0.75 : initialQuality >= 2 ? 1 : Math.min(window.devicePixelRatio, 2),
);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = initialQuality < 2;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 9000);

const terrain = createTerrain();
const obstacles = createObstacles(terrain);
const world = buildWorld(scene, renderer, terrain, obstacles);
const post = queryParams.has('nopost')
  ? { render: () => renderer.render(scene, camera), setSize() {} }
  : createPost(renderer, scene, camera);
const model = createRiderModel();
scene.add(model.root);
const dust = createDust(scene);
const audio = createAudio();

const ui = {
  speed: document.getElementById('speed'),
  timer: document.getElementById('timer'),
  progress: document.getElementById('progress-fill'),
  flash: document.getElementById('flash'),
  overlay: document.getElementById('overlay'),
  title: document.getElementById('overlay-title'),
  body: document.getElementById('overlay-body'),
  button: document.getElementById('overlay-button'),
  mute: document.getElementById('mute'),
  volume: document.getElementById('volume'),
};
ui.mute.textContent = audio.muted ? 'Sound off' : 'Sound on';
ui.mute.addEventListener('click', () => { ui.mute.textContent = audio.toggleMute() ? 'Sound off' : 'Sound on'; ui.mute.blur(); });
ui.volume.value = String(audio.volume);
ui.volume.addEventListener('input', () => audio.setVolume(Number(ui.volume.value)));

const keys = { left: false, right: false, throttle: false, brake: false };
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'brake', ArrowDown: 'brake', Space: 'brake',
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'Enter' && game.mode !== 'riding') start();
  if (e.code === 'KeyR' && game.mode === 'riding') respawn(true);
  if (e.code === 'KeyM') ui.mute.click();
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
for (const button of document.querySelectorAll('#touch button')) {
  const key = button.dataset.key;
  const set = (value) => (e) => { e.preventDefault(); keys[key] = value; button.classList.toggle('active', value); };
  button.addEventListener('pointerdown', set(true));
  button.addEventListener('pointerup', set(false));
  button.addEventListener('pointercancel', set(false));
  button.addEventListener('pointerleave', set(false));
}
ui.button.addEventListener('click', () => start());

const readInput = () => ({
  throttle: keys.throttle ? 1 : 0,
  brake: keys.brake ? 1 : 0,
  steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
});

const game = {
  mode: 'ready',
  bike: null,
  prev: null,
  time: 0,
  penalty: 0,
  checkpoint: -1,
  crashTimer: 0,
  maxSpeed: 0,
  airTime: 0,
  timeScale: 1,
  quality: initialQuality,
  qualityFps: null,
  assetsReady: false,
  crashedSinceCheckpoint: false,
  trauma: 0,
  best: Number(localStorage.getItem('downhill-best')) || null,
};
let slowMoRealTime = 0;
let slowMoLocked = false;

function snapshot(b) {
  return { x: b.x, y: b.y, z: b.z, heading: b.heading, lean: b.lean };
}

function placeBike(x, z, heading, speed) {
  game.bike = createBike({ x, z, heading }, terrain);
  game.bike.v = speed;
  game.prev = snapshot(game.bike);
}

function startPose() {
  const z = -6;
  const heading = Math.atan2(terrain.centerX(z - 0.5) - terrain.centerX(z + 0.5), 1);
  return { x: terrain.centerX(z), z, heading };
}

function start() {
  audio.unlock().then(() => audio.event('start'));
  const p = startPose();
  placeBike(p.x, p.z, p.heading, 0);
  game.mode = 'riding';
  game.time = 0;
  game.penalty = 0;
  game.checkpoint = -1;
  game.maxSpeed = 0;
  game.timeScale = 1;
  slowMoRealTime = 0;
  slowMoLocked = false;
  game.crashedSinceCheckpoint = false;
  ui.overlay.classList.add('hidden');
  snapCamera();
}

function respawn(manual) {
  if (manual && game.mode === 'riding') game.penalty += CRASH_PENALTY;
  const cp = terrain.checkpoints[game.checkpoint];
  const p = cp ? { x: cp.x, z: cp.z, heading: cp.heading } : startPose();
  placeBike(p.x, p.z, p.heading, cp ? 5 : 0);
  model.resetCrash();
  game.airTime = 0;
  game.timeScale = 1;
  slowMoRealTime = 0;
  slowMoLocked = false;
  game.mode = 'riding';
  snapCamera();
}

let flashTimeout;
function flash(text, ms = 1200) {
  ui.flash.textContent = text;
  ui.flash.classList.add('show');
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => ui.flash.classList.remove('show'), ms);
}

const CRASH_TEXT = {
  washout: 'Washed out',
  'hard landing': 'Cased it',
  'off course': 'Off course',
  rock: 'Ottified!',
  stump: 'Hit a stump',
  log: 'Hit a log',
  tree: 'Hit a tree',
};

function showOverlay(title, body, button) {
  ui.title.textContent = title;
  ui.body.textContent = body;
  ui.button.textContent = button;
  ui.overlay.classList.remove('hidden');
}

function simulate(input) {
  const b = game.bike;
  game.prev = snapshot(b);
  if (game.mode === 'crashed') {
    game.crashTimer -= DT;
    if (game.crashTimer <= 0) respawn(false);
    return;
  }
  if (game.mode !== 'riding') return;
  const wasAir = b.airborne;
  stepBike(b, input, terrain, obstacles, DT);
  game.time += DT;
  if (b.landingImpact > 0) {
    game.trauma = Math.min(
      1,
      game.trauma + Math.max(0, Math.min(1, (b.landingImpact - 4) / 7)),
    );
  }
  if (b.airborne) game.airTime += DT;
  if (!wasAir && b.airborne) {
    const kicker = terrain.kickers.find((item) => Math.abs(item.z - b.z) < 8);
    if (kicker) audio.event('kicker', b.v);
  }
  if (wasAir && !b.airborne && !b.crashed) {
    audio.event('land');
    if (game.airTime > 0.7) flash('Big air', 800);
  }
  if (!b.airborne) game.airTime = 0;
  game.maxSpeed = Math.max(game.maxSpeed, b.v);
  const s = -b.z;
  const next = terrain.checkpoints[game.checkpoint + 1];
  if (next && s >= next.s) {
    game.checkpoint += 1;
    flash(`Checkpoint ${game.checkpoint + 1}`, 900);
    audio.event('checkpoint', !game.crashedSinceCheckpoint && !b.crashed);
    game.crashedSinceCheckpoint = false;
  }
  if (b.crashed) {
    game.mode = 'crashed';
    game.trauma = 1;
    game.crashHeading = b.heading;
    game.crashedSinceCheckpoint = true;
    game.penalty += CRASH_PENALTY;
    game.crashTimer = RESPAWN_DELAY;
    model.root.position.set(b.x, b.y, b.z);
    model.startCrash({ v: b.v, heading: b.heading, reason: b.crashed });
    audio.event('crash', b.crashed);
    flash(`${CRASH_TEXT[b.crashed] || 'Crashed'}  +${CRASH_PENALTY}s`, 1500);
  } else if (b.z <= terrain.finishZ) {
    game.mode = 'finished';
    const total = game.time + game.penalty;
    const isBest = !game.best || total < game.best;
    if (isBest) {
      game.best = total;
      localStorage.setItem('downhill-best', String(total));
    }
    audio.event('finish');
    if (isBest) audio.event('best');
    showOverlay(
      isBest ? 'New best' : 'Finished',
      `${total.toFixed(2)} s  (penalties ${game.penalty} s)  top ${Math.round(game.maxSpeed * 3.6)} km/h  best ${game.best.toFixed(2)} s`,
      'Ride again',
    );
  }
}

const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 65 };
const render = { x: 0, y: 0, z: 0, heading: 0, lean: 0 };

function interpolate(alpha) {
  const a = game.prev;
  const b = game.bike;
  render.x = a.x + (b.x - a.x) * alpha;
  render.y = a.y + (b.y - a.y) * alpha;
  render.z = a.z + (b.z - a.z) * alpha;
  render.heading = a.heading + (b.heading - a.heading) * alpha;
  render.lean = a.lean + (b.lean - a.lean) * alpha;
}

function cameraTarget(out, look) {
  const crashFocus = game.mode === 'crashed' ? model.getCrashFollowPosition() : null;
  const focus = crashFocus || render;
  const heading = crashFocus ? game.crashHeading : render.heading;
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  out.set(focus.x - fx * 6.2, focus.y + 2.5, focus.z - fz * 6.2);
  const ground = terrain.heightAt(out.x, out.z) + 1.2;
  if (out.y < ground) out.y = ground;
  look.set(focus.x + fx * 5, focus.y + 0.9, focus.z + fz * 5);
}

function snapCamera() {
  interpolate(1);
  cameraTarget(cam.pos, cam.look);
}

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const shakeOffset = new THREE.Vector3();
let shakeTime = 0;

function smoothNoise(time, phase) {
  return (
    Math.sin(time * 2.1 + phase)
    + 0.5 * Math.sin(time * 3.7 + phase * 1.7)
    + 0.25 * Math.sin(time * 6.3 + phase * 2.3)
  ) / 1.75;
}

function updateCamera(dt) {
  const b = game.bike;
  cameraTarget(tmpPos, tmpLook);
  const k = 1 - Math.exp(-(game.mode === 'crashed' ? 1.5 : 6) * dt);
  cam.pos.lerp(tmpPos, k);
  cam.look.lerp(tmpLook, 1 - Math.exp(-10 * dt));
  game.trauma = Math.max(0, game.trauma - 2.5 * dt);
  shakeTime += dt;
  const traumaScale = game.trauma * game.trauma;
  shakeOffset.set(
    smoothNoise(shakeTime, 0.4),
    smoothNoise(shakeTime, 1.7),
    smoothNoise(shakeTime, 3.2),
  ).multiplyScalar(0.25 * traumaScale);
  camera.position.copy(cam.pos).add(shakeOffset);
  camera.lookAt(cam.look);
  camera.rotateZ(smoothNoise(shakeTime, 4.8) * 0.04 * traumaScale);
  const targetFov = 62 + Math.min(20, b.v * 0.8);
  cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-3 * dt));
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

function gradeAt(b) {
  const dx = Math.sin(b.heading) * 0.6;
  const dz = -Math.cos(b.heading) * 0.6;
  return (terrain.heightAt(b.x + dx, b.z + dz) - terrain.heightAt(b.x - dx, b.z - dz)) / 1.2;
}

function updateHud() {
  const b = game.bike;
  ui.speed.textContent = String(Math.round(b.v * 3.6));
  ui.timer.textContent = (game.time + game.penalty).toFixed(2);
  ui.progress.style.width = `${Math.min(100, Math.max(0, (-b.z / terrain.courseLength) * 100))}%`;
}

let accumulator = 0;
let last = performance.now();
let assetsReady = false;
let qualityWindowElapsed = 0;
let qualityFrameCount = 0;

function applyQualityLevel(level) {
  game.quality = level;
  renderer.shadowMap.enabled = level < 2;
  const pixelRatio = level >= 3
    ? 0.75
    : level >= 2
      ? 1
      : Math.min(window.devicePixelRatio, 2);
  if (renderer.getPixelRatio() !== pixelRatio) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
  }
}

function updateAutoQuality(realDt) {
  if (!autoQualityEnabled || !assetsReady) return;
  qualityWindowElapsed += realDt;
  qualityFrameCount += 1;
  if (qualityWindowElapsed < 3) return;
  const avgFps = qualityFrameCount / qualityWindowElapsed;
  game.qualityFps = avgFps;
  const nextLevel = nextQualityLevel(avgFps, game.quality);
  if (nextLevel !== game.quality) applyQualityLevel(nextLevel);
  qualityWindowElapsed = 0;
  qualityFrameCount = 0;
}

function updateTimeScale(realDt) {
  const bike = game.bike;
  const airborne = game.mode === 'riding' && bike.airborne;
  if (!airborne) {
    slowMoRealTime = 0;
    slowMoLocked = false;
  }
  const heightAboveGround = Math.max(0, bike.y - terrain.heightAt(bike.x, bike.z));
  const target = game.mode === 'riding'
    ? slowMoTarget(bike, heightAboveGround, game.airTime)
    : 1;
  if (!slowMoLocked && (target < 1 || game.timeScale < 1)) {
    slowMoRealTime += realDt;
    if (slowMoRealTime >= 1.2) slowMoLocked = true;
  }
  const effectiveTarget = slowMoLocked ? 1 : target;
  const maxChange = 8 * realDt;
  game.timeScale += Math.max(-maxChange, Math.min(maxChange, effectiveTarget - game.timeScale));
}

function frame(now) {
  const frameDt = Math.max(0, (now - last) / 1000);
  const dt = Math.min(0.1, frameDt);
  last = now;
  updateAutoQuality(frameDt);
  updateTimeScale(frameDt);
  accumulator += dt * game.timeScale;
  const input = readInput();
  let steps = 0;
  while (accumulator >= DT && steps < 12) {
    simulate(input);
    accumulator -= DT;
    steps += 1;
  }
  if (steps === 12) accumulator = 0;
  interpolate(accumulator / DT);
  model.root.position.set(render.x, render.y, render.z);
  model.update(
    { ...game.bike, heading: render.heading, lean: render.lean },
    game.mode === 'riding' ? input : {},
    gradeAt(game.bike),
    dt,
    terrain.heightAt,
  );
  world.followSun(model.root.position);
  dust.update(game.bike, game.mode === 'riding', dt);
  audio.update(game.bike, input, game.mode === 'riding', dt, game.timeScale);
  updateCamera(dt);
  updateHud();
  if (game.quality >= 1) renderer.render(scene, camera);
  else post.render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

const p = startPose();
placeBike(p.x, p.z, p.heading, 0);
snapCamera();
const modelNames = ['rider-body', 'bike-frame', 'bike-wheel', 'boulder', 'rock-flat', 'stump', 'log', 'pine-a', 'pine-b', 'otter'];
if (debug) {
  game.assetStatus = { state: 'loading', loaded: [], missing: [] };
  window.__assetLoadErrors = {};
  window.__riderModel = model;
}
loadModels(modelNames).then((models) => {
  if (debug) window.__models = models;
  const riderApplied = models['rider-body'] && models['bike-frame'] && models['bike-wheel']
    ? model.setAssets({
      riderBody: models['rider-body'],
      bikeFrame: models['bike-frame'],
      bikeWheel: models['bike-wheel'],
    })
    : false;
  world.applyModels(models);
  assetsReady = Boolean(riderApplied);
  game.assetsReady = assetsReady;
  qualityWindowElapsed = 0;
  qualityFrameCount = 0;
  if (debug) {
    game.assetStatus = {
      state: riderApplied ? 'ready' : 'fallback',
      loaded: Object.keys(models),
      missing: modelNames.filter((name) => !models[name]),
      rider: model.getAssetStatus(),
      loadErrors: { ...window.__assetLoadErrors },
    };
  }
}).catch((error) => {
  assetsReady = false;
  game.assetsReady = false;
  if (debug) {
    game.assetStatus = { state: 'error', error: String(error), loadErrors: { ...window.__assetLoadErrors } };
  }
});
if (debug) {
  window.__game = game;
  window.__terrain = terrain;
  window.__camera = camera;
  window.__scene = scene;
  window.__captureFrame = (position, target) => {
    camera.position.fromArray(position);
    camera.lookAt(new THREE.Vector3(...target));
    if (game.quality >= 1) renderer.render(scene, camera);
    else post.render();
    return renderer.domElement.toDataURL('image/png');
  };
}
requestAnimationFrame((t) => { last = t; frame(t); });
