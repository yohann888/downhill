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

const CRASH_PENALTY = 3;
const RESPAWN_DELAY = 1.6;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 9000);

const terrain = createTerrain();
const obstacles = createObstacles(terrain);
const world = buildWorld(scene, renderer, terrain, obstacles);
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
  crashedSinceCheckpoint: false,
  best: Number(localStorage.getItem('downhill-best')) || null,
};

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
  game.crashedSinceCheckpoint = false;
  ui.overlay.classList.add('hidden');
  snapCamera();
}

function respawn(manual) {
  if (manual && game.mode === 'riding') game.penalty += CRASH_PENALTY;
  const cp = terrain.checkpoints[game.checkpoint];
  const p = cp ? { x: cp.x, z: cp.z, heading: cp.heading } : startPose();
  placeBike(p.x, p.z, p.heading, cp ? 5 : 0);
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
  rock: 'Hit a rock',
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
    audio.event('checkpoint', !game.crashedSinceCheckpoint);
    game.crashedSinceCheckpoint = false;
  }
  if (b.crashed) {
    game.mode = 'crashed';
    game.crashedSinceCheckpoint = true;
    game.penalty += CRASH_PENALTY;
    game.crashTimer = RESPAWN_DELAY;
    audio.event('crash');
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

const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 65, shake: 0 };
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
  const fx = Math.sin(render.heading);
  const fz = -Math.cos(render.heading);
  out.set(render.x - fx * 6.2, render.y + 2.5, render.z - fz * 6.2);
  const ground = terrain.heightAt(out.x, out.z) + 1.2;
  if (out.y < ground) out.y = ground;
  look.set(render.x + fx * 5, render.y + 0.9, render.z + fz * 5);
}

function snapCamera() {
  interpolate(1);
  cameraTarget(cam.pos, cam.look);
}

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
let wasAirborne = false;

function updateCamera(dt) {
  const b = game.bike;
  cameraTarget(tmpPos, tmpLook);
  const k = 1 - Math.exp(-(game.mode === 'crashed' ? 1.5 : 6) * dt);
  cam.pos.lerp(tmpPos, k);
  cam.look.lerp(tmpLook, 1 - Math.exp(-10 * dt));
  if (wasAirborne && !b.airborne) cam.shake = Math.min(0.35, 0.08 + Math.abs(b.vy) * 0.02);
  wasAirborne = b.airborne;
  const rough = !b.airborne && b.v > 4 ? Math.min(0.03, b.v * 0.0012) + (b.slipping ? 0.04 : 0) : 0;
  cam.shake = Math.max(cam.shake * Math.exp(-6 * dt), rough);
  const t = performance.now() * 0.001;
  camera.position.copy(cam.pos);
  camera.position.x += Math.sin(t * 37) * cam.shake * 0.5;
  camera.position.y += Math.sin(t * 43 + 1) * cam.shake * 0.5;
  camera.lookAt(cam.look);
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
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += dt;
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
  model.update({ ...game.bike, heading: render.heading, lean: render.lean }, game.mode === 'riding' ? input : {}, gradeAt(game.bike), dt);
  world.followSun(model.root.position);
  dust.update(game.bike, game.mode === 'riding', dt);
  audio.update(game.bike, input, game.mode === 'riding', dt);
  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const p = startPose();
placeBike(p.x, p.z, p.heading, 0);
snapCamera();
const debug = new URLSearchParams(window.location.search).has('debug');
loadModels(['rider', 'boulder', 'rock-flat', 'stump', 'log', 'pine-a', 'pine-b']).then((models) => {
  if (models.rider) model.setGlb(models.rider);
  world.applyModels(models);
});
if (debug) {
  window.__game = game;
  window.__terrain = terrain;
  window.__camera = camera;
  window.__scene = scene;
}
requestAnimationFrame((t) => { last = t; frame(t); });
