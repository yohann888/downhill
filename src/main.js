import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyPickup, createBike, stepBike } from './physics/bike.js';
import { DT } from './physics/constants.js';
import { createObstacles, updateMovingObstacles } from './world/obstacles.js';
import { createTerrain } from './world/terrain.js';
import { createPickups, PICKUP_RADIUS, PICKUP_REACH } from './world/pickups.js';
import { buildWorld } from './render/world.js';
import { createRiderModel } from './render/rider.js';
import { createDust } from './render/dust.js';
import { createAudio } from './audio.js';
import { parseYouTubeId } from './youtube.js';
import { loadModel, loadModels } from './render/assets.js';
import { createPost } from './render/post.js';
import {
  airTimeBonus,
  heightBonus,
  nextQualityLevel,
  slowMoTarget,
} from './feel.js';
import { getCommentary, getLeaderboard, postRun } from './api.js';
import { buildRankOverlayRows, cleanText, rivalLine } from './leaderboard.js';
import { createRecorder, sampleGhost } from './ghost.js';
import {
  loadRiderPreference,
  RIDER_OPTIONS,
  saveRiderPreference,
} from './rider-preference.js';

const CRASH_PENALTY = 3;
const RESPAWN_DELAY = 1.6;
const queryParams = new URLSearchParams(window.location.search);
const qualityMode = queryParams.get('quality');
const initialQuality = qualityMode === 'low' ? 3 : 0;
const autoQualityEnabled = qualityMode !== 'high';
const debug = queryParams.has('debug');
const requestedTime = queryParams.get('time');
const storedTime = localStorage.getItem('downhill.time');
let timeMode = ['day', 'night'].includes(requestedTime)
  ? requestedTime
  : ['day', 'night'].includes(storedTime)
    ? storedTime
    : 'day';

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
const pickups = createPickups(terrain, obstacles);
const world = buildWorld(scene, renderer, terrain, obstacles, pickups);
const post = queryParams.has('nopost')
  ? { render: () => renderer.render(scene, camera), setSize() {} }
  : createPost(renderer, scene, camera);
const model = createRiderModel();
scene.add(model.root);
const ghostModel = createRiderModel();
ghostModel.root.visible = false;
scene.add(ghostModel.root);
const ghostRecorder = createRecorder();
let bestGhost = null;
let ghostAssetsReady = false;
let leaderboardEntries = [];
let submittedRank = null;
let leaderboardReturnFocus = null;
let leaderboardRequestId = 0;
let commentaryTimeout;
const dust = createDust(scene, terrain);
const audio = createAudio();
let selectedRider = loadRiderPreference();
let baseModels = null;
let riderLoadVersion = 0;
const backPrintPromise = new THREE.TextureLoader().loadAsync('./assets/otter-back.png');

const ui = {
  speed: document.getElementById('speed'),
  timer: document.getElementById('timer'),
  coffeeTimer: document.getElementById('coffee-timer'),
  energyTimer: document.getElementById('energy-timer'),
  progress: document.getElementById('progress-fill'),
  progressPercent: document.getElementById('progress-percent'),
  checkpointMarks: document.getElementById('checkpoint-marks'),
  ghostProgress: document.getElementById('ghost-progress'),
  flash: document.getElementById('flash'),
  overlay: document.getElementById('overlay'),
  title: document.getElementById('overlay-title'),
  body: document.getElementById('overlay-body'),
  button: document.getElementById('overlay-button'),
  menuButton: document.getElementById('menu-button'),
  startLeaderboard: document.getElementById('start-leaderboard'),
  startBest: document.getElementById('start-best'),
  finishForm: document.getElementById('finish-controls'),
  nameInput: document.getElementById('rider-name'),
  submitButton: document.querySelector('#finish-controls button[type="submit"]'),
  finishLeaderboard: document.getElementById('finish-leaderboard'),
  leaderboardTitle: document.getElementById('leaderboard-open-title'),
  leaderboardFinish: document.getElementById('leaderboard-open-finish'),
  leaderboardWave: document.getElementById('leaderboard-open-wave'),
  leaderboardOverlay: document.getElementById('leaderboard-overlay'),
  leaderboardClose: document.getElementById('leaderboard-close'),
  fullLeaderboard: document.getElementById('full-leaderboard-list'),
  wavePanel: document.getElementById('wave-panel'),
  waveLeaderboard: document.getElementById('wave-leaderboard'),
  waveRivalLine: document.getElementById('wave-rival-line'),
  waveBadge: document.getElementById('brand-badge-wave'),
  rideAgain: document.getElementById('wave-ride-again'),
  waveMenu: document.getElementById('wave-menu'),
  hud: document.getElementById('hud'),
  touch: document.getElementById('touch'),
  ghostStatus: document.getElementById('ghost-status'),
  subtitle: document.getElementById('commentary-subtitle'),
  mute: document.getElementById('mute'),
  music: document.getElementById('music-select'),
  timeToggle: document.getElementById('time-toggle'),
  volume: document.getElementById('volume'),
};
ui.mute.textContent = audio.muted ? 'Sound off' : 'Sound on';
const menuMusic = document.getElementById('menu-music');
const youtubeControls = document.getElementById('youtube-music-controls');
const youtubeLink = document.getElementById('youtube-link');
const youtubePlay = document.getElementById('youtube-play');
const youtubeMessage = document.getElementById('youtube-message');
const youtubeContainer = document.getElementById('youtube-player-container');
let youtubePlayer = null;
let youtubeApiPromise = null;
let youtubeReadyPromise = null;
let youtubePlayerReady = false;
let youtubeRequested = false;
let youtubeErrorActive = false;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = reject;
    window.onYouTubeIframeAPIReady = () => resolve();
    document.head.append(script);
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });
  return youtubeApiPromise;
}

function syncYouTubeUi() {
  const active = audio.music.id === 'youtube';
  const playerSlot = ui.overlay.classList.contains('start') && !ui.overlay.classList.contains('hidden')
    ? document.getElementById('youtube-player-slot')
    : ui.hud;
  if (youtubeContainer.parentElement !== playerSlot) playerSlot.append(youtubeContainer);
  youtubeControls.hidden = !active && !youtubeErrorActive;
  youtubeContainer.hidden = !active;
  if (active && playerSlot.id === 'youtube-player-slot') {
    const revealPlayer = () => {
      const panel = ui.overlay.querySelector('.panel');
      if (getComputedStyle(panel).overflowY !== 'auto') return;
      const playerBounds = youtubeContainer.getBoundingClientRect();
      const panelBounds = panel.getBoundingClientRect();
      if (playerBounds.bottom > panelBounds.bottom) panel.scrollTop += playerBounds.bottom - panelBounds.bottom;
      else if (playerBounds.top < panelBounds.top) panel.scrollTop -= panelBounds.top - playerBounds.top;
    };
    requestAnimationFrame(revealPlayer);
    void document.fonts.ready.then(revealPlayer);
  }
  if (!active) {
    youtubeRequested = false;
    youtubePlayer?.pauseVideo();
    audio.setYouTubePlaying(false);
    return;
  }
  youtubeLink.value = localStorage.getItem('downhill.youtube-link') || '';
  youtubePlay.disabled = !youtubePlayerReady;
  void loadYouTubeApi().then(() => {
    if (youtubePlayer) return;
    youtubeReadyPromise = new Promise((resolve) => {
      youtubePlayer = new window.YT.Player('youtube-player', {
        width: 200,
        height: 113,
        videoId: '',
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            youtubePlayer.setVolume(Math.round(audio.volume * 100));
            youtubePlayerReady = true;
            youtubePlay.disabled = false;
            resolve();
          },
          onStateChange: (event) => {
            const playing = event.data === window.YT.PlayerState.PLAYING;
            audio.setYouTubePlaying(playing);
            if (event.data === window.YT.PlayerState.ENDED) {
              youtubePlayer.seekTo(0);
              if (youtubeRequested && !audio.muted) youtubePlayer.playVideo();
            }
          },
          onError: (event) => {
            if (event.data !== 101 && event.data !== 150) return;
            youtubeMessage.textContent = "This video can't be embedded. Try another link.";
            youtubeErrorActive = true;
            youtubeRequested = false;
            youtubePlayer.pauseVideo();
            audio.setMusic(audio.previousMusic.id);
            syncMusicUi();
          },
        },
      });
    });
  }).catch(() => {
    youtubeMessage.textContent = 'YouTube is unavailable.';
  });
}

async function playYouTubeLink() {
  const link = youtubeLink.value.trim();
  const id = parseYouTubeId(link);
  if (!id) {
    youtubeMessage.textContent = 'Enter a valid YouTube link.';
    return false;
  }
  localStorage.setItem('downhill.youtube-link', link);
  youtubeErrorActive = false;
  youtubeMessage.textContent = '';
  youtubeRequested = true;
  if (audio.music.id !== 'youtube') {
    audio.setMusic('youtube');
    syncMusicUi();
  } else {
    syncYouTubeUi();
  }
  try {
    await loadYouTubeApi();
    if (youtubeReadyPromise) await youtubeReadyPromise;
    if (audio.muted) return true;
    if (youtubePlayer?.loadVideoById) {
      youtubePlayer.loadVideoById(id);
      youtubePlayer.playVideo();
      youtubePlayer.setVolume(Math.round(audio.volume * 100));
    }
    return true;
  } catch {
    youtubeMessage.textContent = 'YouTube is unavailable.';
    return false;
  }
}

youtubePlay.addEventListener('click', () => { void playYouTubeLink(); });
const menuRider = document.querySelector('#menu-rider .rider-options');
const riderButtons = new Map();
function syncRiderUi(loading = false) {
  for (const [id, button] of riderButtons) {
    button.setAttribute('aria-pressed', String(id === selectedRider));
    button.disabled = loading;
  }
}
for (const option of RIDER_OPTIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rider-card';
  button.dataset.rider = option.id;
  const portrait = document.createElement('img');
  portrait.src = `./assets/rider-${option.id}.png`;
  portrait.alt = '';
  const label = document.createElement('span');
  label.textContent = option.label;
  button.append(portrait, label);
  button.addEventListener('click', async () => {
    selectedRider = saveRiderPreference(option.id);
    syncRiderUi(true);
    await applySelectedRider();
    button.blur();
  });
  riderButtons.set(option.id, button);
  menuRider.append(button);
}
syncRiderUi();
function syncMusicUi() {
  ui.music.textContent = `Music: ${audio.music.label}`;
  audio.setRain(audio.music.id === 'music-rain');
  world.setRain(audio.music.id === 'music-rain', initialQuality >= 2);
  syncYouTubeUi();
  for (const button of menuMusic.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.track === audio.music.id));
  }
}
for (const track of audio.tracks) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.track = track.id;
  button.textContent = track.label;
  button.addEventListener('click', () => {
    youtubeErrorActive = false;
    youtubeMessage.textContent = '';
    if (track.id !== 'youtube') {
      youtubeRequested = false;
      youtubePlayer?.pauseVideo();
    }
    audio.setMusic(track.id);
    syncMusicUi();
    button.blur();
  });
  menuMusic.append(button);
}
syncMusicUi();
ui.timeToggle.textContent = timeMode === 'night' ? 'Night' : 'Day';
for (const checkpoint of terrain.checkpoints) {
  const mark = document.createElement('span');
  const progress = Math.max(0, Math.min(1, -checkpoint.z / terrain.courseLength));
  mark.className = 'checkpoint-mark';
  mark.style.left = `${progress * 100}%`;
  ui.checkpointMarks.append(mark);
}
ui.mute.addEventListener('click', () => {
  const muted = audio.toggleMute();
  ui.mute.textContent = muted ? 'Sound off' : 'Sound on';
  if (muted) youtubePlayer?.pauseVideo();
  else if (youtubeRequested && audio.music.id === 'youtube') youtubePlayer?.playVideo();
  ui.mute.blur();
});
ui.music.addEventListener('click', () => {
  youtubeErrorActive = false;
  youtubeMessage.textContent = '';
  audio.nextMusic();
  syncMusicUi();
  ui.music.blur();
});
function setTimeMode(mode, persist = true) {
  timeMode = mode === 'night' ? 'night' : 'day';
  world.setTimeOfDay(timeMode);
  model.setHeadlamp(timeMode === 'night');
  ui.timeToggle.textContent = timeMode === 'night' ? 'Night' : 'Day';
  if (persist) localStorage.setItem('downhill.time', timeMode);
}
ui.timeToggle.addEventListener('click', () => {
  setTimeMode(timeMode === 'night' ? 'day' : 'night');
  ui.timeToggle.blur();
});
setTimeMode(timeMode, false);
ui.volume.value = String(audio.volume);
ui.volume.addEventListener('input', () => {
  audio.setVolume(Number(ui.volume.value));
  youtubePlayer?.setVolume(Math.round(audio.volume * 100));
});

const keys = { left: false, right: false, throttle: false, brake: false, jump: false };
let jumpQueued = false;
const touchControls = document.querySelector('#touch');
const touchButtons = [...document.querySelectorAll('#touch button')];
function setKey(key, value) {
  if (key === 'jump' && value && !keys.jump) jumpQueued = true;
  keys[key] = value;
  for (const button of touchButtons) {
    if (button.dataset.key === key) button.classList.toggle('active', value);
  }
}
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'brake', ArrowDown: 'brake',
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !ui.leaderboardOverlay.hidden) {
    e.preventDefault();
    closeLeaderboard();
    return;
  }
  if (e.code === 'Escape' && (game.mode === 'finished' || game.waveMode)) {
    e.preventDefault();
    showMenu();
    return;
  }
  if (e.target === ui.nameInput) return;
  if (e.code === 'KeyB' && !e.repeat) {
    e.preventDefault();
    if (ui.leaderboardOverlay.hidden) openLeaderboard();
    else closeLeaderboard();
    return;
  }
  if (!ui.leaderboardOverlay.hidden) {
    if (e.code === 'Enter' || e.code === 'Space') {
      if (ui.leaderboardOverlay.contains(document.activeElement)) return;
      e.preventDefault();
    }
    return;
  }
  if (e.code === 'KeyN' && !e.repeat) {
    ui.music.click();
    e.preventDefault();
  }
  if (e.code === 'KeyL' && !e.repeat) {
    ui.timeToggle.click();
    e.preventDefault();
  }
  if (game.waveMode) {
    if (e.code === 'Enter' || e.code === 'KeyR') start();
    e.preventDefault();
    return;
  }
  if (KEYMAP[e.code]) {
    setKey(KEYMAP[e.code], true);
    e.preventDefault();
  }
  if (e.code === 'Space' || e.code === 'KeyJ') {
    setKey('jump', true);
    e.preventDefault();
  }
  if (e.code === 'Enter' && game.mode === 'finished' && e.target !== ui.nameInput) {
    e.preventDefault();
    submitRun();
    } else if (e.code === 'Enter' && youtubeControls.contains(e.target)) {
      e.preventDefault();
    } else if (e.code === 'Enter' && game.mode !== 'riding' && game.mode !== 'finished') start();
  if (e.code === 'KeyR' && game.mode === 'riding') respawn(true);
  if (e.code === 'KeyM') ui.mute.click();
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) setKey(KEYMAP[e.code], false);
  if (e.code === 'Space' || e.code === 'KeyJ') setKey('jump', false);
});
window.addEventListener('blur', () => {
  for (const k in keys) setKey(k, false);
  jumpQueued = false;
});
for (const button of touchButtons) {
  const key = button.dataset.key;
  const set = (value) => (e) => {
    e.preventDefault();
    setKey(key, value);
  };
  button.addEventListener('pointerdown', set(true));
  button.addEventListener('pointerup', set(false));
  button.addEventListener('pointercancel', set(false));
  button.addEventListener('pointerleave', set(false));
}
ui.button.addEventListener('click', () => start());
ui.finishForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitRun();
});
ui.rideAgain.addEventListener('click', () => start());
ui.menuButton.addEventListener('click', () => showMenu());
ui.waveMenu.addEventListener('click', () => showMenu());
ui.leaderboardTitle.addEventListener('click', openLeaderboard);
ui.leaderboardFinish.addEventListener('click', openLeaderboard);
ui.leaderboardWave.addEventListener('click', openLeaderboard);
ui.leaderboardClose.addEventListener('click', closeLeaderboard);
ui.leaderboardOverlay.addEventListener('click', (event) => {
  if (event.target === ui.leaderboardOverlay) closeLeaderboard();
});

const readInput = () => ({
  throttle: keys.throttle ? 1 : 0,
  brake: keys.brake ? 1 : 0,
  steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
  jump: jumpQueued ? 1 : 0,
});

const game = {
  mode: 'ready',
  bike: null,
  prev: null,
  time: 0,
  penalty: 0,
  bonus: 0,
  checkpoint: -1,
  crashTimer: 0,
  maxSpeed: 0,
  airTime: 0,
  airPeak: 0,
  airDoubleJumped: false,
  maxAir: 0,
  maxHeight: 0,
  crashes: 0,
  otterHits: 0,
  timeScale: 1,
  quality: initialQuality,
  qualityFps: null,
  assetsReady: false,
  crashedSinceCheckpoint: false,
  runId: 0,
  runSubmitted: false,
  runSubmitting: false,
  leaderboardWarmed: false,
  waveMode: false,
  trauma: 0,
  best: Number(localStorage.getItem('downhill-best-900')) || null,
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

function resetPickups() {
  pickups.forEach((pickup, index) => {
    pickup.taken = false;
    world.setPickupVisible(index, true);
  });
}

function clearPowerUps(bike = game.bike) {
  if (!bike) return;
  bike.boostTime = 0;
  bike.boostTarget = 0;
  bike.doubleJumpTime = 0;
  bike.doubleJumpUsed = false;
  bike.doubleJumped = false;
}

function startPose() {
  const z = -6;
  const heading = Math.atan2(terrain.centerX(z - 0.5) - terrain.centerX(z + 0.5), 1);
  return { x: terrain.centerX(z), z, heading };
}

function start() {
  if (game.waveMode) endWave();
  closeLeaderboard(false);
  if (audio.music.id === 'youtube' && parseYouTubeId(localStorage.getItem('downhill.youtube-link'))) {
    void playYouTubeLink();
  }
  audio.unlock().then(() => audio.event('start'));
  const p = startPose();
  placeBike(p.x, p.z, p.heading, 0);
  resetPickups();
  clearPowerUps();
  game.mode = 'riding';
  game.time = 0;
  game.airTime = 0;
  game.airPeak = 0;
  game.airDoubleJumped = false;
  updateMovingObstacles(obstacles, 0);
  world.update(0);
  game.penalty = 0;
  game.bonus = 0;
  game.checkpoint = -1;
  game.maxSpeed = 0;
  game.maxAir = 0;
  game.maxHeight = 0;
  game.crashes = 0;
  game.otterHits = 0;
  game.runId += 1;
  game.runSubmitted = false;
  game.runSubmitting = false;
  submittedRank = null;
  game.leaderboardWarmed = false;
  ghostRecorder.reset();
  game.timeScale = 1;
  slowMoRealTime = 0;
  slowMoLocked = false;
  game.crashedSinceCheckpoint = false;
  ui.finishForm.hidden = true;
  ui.nameInput.disabled = false;
  ui.submitButton.disabled = false;
  ui.submitButton.textContent = 'Submit';
  ui.finishLeaderboard.hidden = true;
  ui.finishLeaderboard.replaceChildren();
  ui.leaderboardFinish.hidden = true;
  ui.wavePanel.hidden = true;
  ui.hud.classList.remove('wave-mode');
  ui.touch.hidden = false;
  ui.overlay.classList.add('hidden');
  syncYouTubeUi();
  snapCamera();
}

function respawn(manual) {
  if (manual && game.mode === 'riding') game.penalty += CRASH_PENALTY;
  const cp = terrain.checkpoints[game.checkpoint];
  const p = cp ? { x: cp.x, z: cp.z, heading: cp.heading } : startPose();
  const doubleJumpTime = game.bike?.doubleJumpTime ?? 0;
  placeBike(p.x, p.z, p.heading, cp ? 5 : 0);
  game.bike.doubleJumpTime = doubleJumpTime;
  game.airDoubleJumped = false;
  model.resetCrash();
  game.airTime = 0;
  game.airPeak = 0;
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
  'off course': 'Off course',
  rock: 'Ottified!',
  stump: 'Hit a stump',
  log: 'Hit a log',
  tree: 'Hit a tree',
};

function placeLabel(rank) {
  if (rank === 1) return '1ST';
  if (rank === 2) return '2ND';
  if (rank === 3) return '3RD';
  return `${rank}TH`;
}

function medalBadge(rank) {
  const medal = { 1: 'gold', 2: 'silver', 3: 'bronze' }[rank];
  if (!medal) return null;
  const badge = document.createElement('span');
  badge.className = `medal medal-${medal}`;
  badge.setAttribute('aria-label', `${placeLabel(rank)} place`);
  if (rank === 1) {
    const crown = document.createElement('span');
    crown.className = 'medal-crown';
    crown.setAttribute('aria-hidden', 'true');
    crown.textContent = '♛';
    badge.append(crown);
  }
  badge.append(document.createTextNode(placeLabel(rank)));
  return badge;
}

function appendRank(cell, rank, label = String(rank)) {
  const badge = medalBadge(rank);
  if (badge) cell.append(badge);
  else cell.textContent = label;
}

function showOverlay(title, body, button) {
  ui.overlay.classList.remove('start');
  ui.leaderboardFinish.hidden = game.mode !== 'finished';
  ui.title.textContent = title;
  ui.body.textContent = body;
  ui.button.textContent = button;
  ui.overlay.classList.remove('hidden');
}

function renderStartBoard(empty = 'No times yet. Set the first one.') {
  const board = ui.startLeaderboard;
  board.replaceChildren();
  if (!leaderboardEntries.length) {
    const note = document.createElement('p');
    note.className = 'menu-empty';
    note.textContent = empty;
    board.append(note);
  } else {
    const list = document.createElement('ol');
    list.className = 'arcade-scores';
    leaderboardEntries.slice(0, 5).forEach((entry, index) => {
      const row = document.createElement('li');
      const place = document.createElement('span');
      place.className = 'place';
      appendRank(place, index + 1, placeLabel(index + 1));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = cleanText(entry.name);
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = Number(entry.time).toFixed(2);
      row.append(place, name, time);
      list.append(row);
    });
    board.append(list);
  }
  ui.startBest.textContent = game.best ? `Your best ${game.best.toFixed(2)}` : '';
}

function refreshStartBoard() {
  renderStartBoard('Loading...');
  return getLeaderboard().then((result) => {
    if (!result) {
      renderStartBoard('Leaderboard offline. Your best still counts.');
      return;
    }
    leaderboardEntries = result.top || [];
    bestGhost = result.ghost || null;
    ui.ghostStatus.textContent = bestGhost
      ? `Ghost: ${bestGhost.name} ${Number(bestGhost.time).toFixed(2)} s`
      : '';
    renderStartBoard();
  });
}

function renderLeaderboard(container, entries, playerRank = null) {
  container.replaceChildren();
  if (!entries?.length) {
    const note = document.createElement('p');
    note.textContent = 'No scores yet';
    container.append(note);
    return;
  }
  const table = document.createElement('table');
  table.className = 'leaderboard';
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['Rank', 'Name', 'Time']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    header.append(cell);
  }
  head.append(header);
  const body = document.createElement('tbody');
  let playerRow = null;
  entries.slice(0, 50).forEach((entry, index) => {
    const row = document.createElement('tr');
    if (index + 1 === playerRank) {
      row.className = 'player-row';
      row.id = 'full-board-player';
      playerRow = row;
    }
    const rankCell = document.createElement('td');
    appendRank(rankCell, index + 1);
    const name = document.createElement('td');
    name.textContent = cleanText(entry.name);
    const time = document.createElement('td');
    time.textContent = `${Number(entry.time).toFixed(2)} s`;
    row.append(rankCell, name, time);
    body.append(row);
  });
  table.append(head, body);
  container.append(table);
  if (playerRow) {
    requestAnimationFrame(() => playerRow.scrollIntoView({ block: 'center' }));
  }
}

function showFullBoardMessage(message) {
  const note = document.createElement('p');
  note.textContent = message;
  ui.fullLeaderboard.replaceChildren(note);
}

function renderRankOverlay(container, rows) {
  container.replaceChildren();
  if (!rows.length) return;
  const table = document.createElement('table');
  table.className = 'leaderboard';
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['Rank', 'Name', 'Time']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    header.append(cell);
  }
  head.append(header);
  const body = document.createElement('tbody');
  for (const entry of rows) {
    const row = document.createElement('tr');
    if (entry.highlighted) row.className = 'player-row';
    const rankCell = document.createElement('td');
    appendRank(rankCell, entry.rank);
    const name = document.createElement('td');
    name.textContent = entry.name;
    const time = document.createElement('td');
    time.textContent = `${Number(entry.time).toFixed(2)} s`;
    row.append(rankCell, name, time);
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}

function openLeaderboard() {
  if (!ui.leaderboardOverlay.hidden) return;
  leaderboardReturnFocus = document.activeElement;
  ui.leaderboardOverlay.hidden = false;
  showFullBoardMessage('Loading...');
  ui.leaderboardClose.focus();
  const requestId = ++leaderboardRequestId;
  getLeaderboard().then((result) => {
    if (requestId !== leaderboardRequestId || ui.leaderboardOverlay.hidden) return;
    if (!result) {
      showFullBoardMessage('Leaderboard offline');
      return;
    }
    leaderboardEntries = Array.isArray(result.top) ? result.top : [];
    bestGhost = result.ghost || null;
    renderStartBoard();
    renderLeaderboard(ui.fullLeaderboard, leaderboardEntries, submittedRank);
  }).catch(() => {
    if (requestId === leaderboardRequestId && !ui.leaderboardOverlay.hidden) {
      showFullBoardMessage('Leaderboard offline');
    }
  });
}

function closeLeaderboard(restoreFocus = true) {
  if (ui.leaderboardOverlay.hidden) return;
  ui.leaderboardOverlay.hidden = true;
  leaderboardRequestId += 1;
  const returnFocus = leaderboardReturnFocus;
  leaderboardReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function makeRunStats(name = 'Rider') {
  const totalTime = game.time + game.penalty - game.bonus;
  return {
    name,
    time: totalTime,
    penalties: game.penalty,
    bonus: game.bonus,
    topSpeed: game.maxSpeed * 3.6,
    crashes: game.crashes,
    otterHits: game.otterHits,
    maxAir: game.maxAir,
  };
}

async function submitRun() {
  if (game.mode !== 'finished' || game.runSubmitted || game.runSubmitting) return;
  const runId = game.runId;
  game.runSubmitting = true;
  ui.nameInput.disabled = true;
  ui.submitButton.disabled = true;
  ui.submitButton.textContent = 'Submitting...';
  try {
    const name = ui.nameInput.value.trim() || 'Rider';
    ui.nameInput.value = name;
    localStorage.setItem('downhill-name', name);
    const run = { ...makeRunStats(name), ghost: ghostRecorder.getGhost() };
    const result = await postRun(run);
    if (runId !== game.runId) return;
    if (!result) {
      ui.finishLeaderboard.textContent = 'Leaderboard unavailable';
      ui.finishLeaderboard.hidden = false;
      return;
    }
    game.runSubmitted = true;
    ui.submitButton.textContent = 'Submitted';
    submittedRank = result.rank ?? null;
    leaderboardEntries = result.top || [];
    renderStartBoard();
    startWave(result, run);
  } catch {
    if (runId === game.runId) {
      ui.finishLeaderboard.textContent = 'Leaderboard unavailable';
      ui.finishLeaderboard.hidden = false;
    }
  } finally {
    if (runId === game.runId) {
      game.runSubmitting = false;
      if (!game.runSubmitted) {
        ui.nameInput.disabled = false;
        ui.submitButton.disabled = false;
        ui.submitButton.textContent = 'Submit';
      }
    }
  }
}

function showCommentary(result) {
  if (!result?.text) return;
  ui.subtitle.textContent = result.text.replace(/[—–]/g, '-');
  ui.subtitle.classList.add('show');
  clearTimeout(commentaryTimeout);
  commentaryTimeout = setTimeout(() => ui.subtitle.classList.remove('show'), 6000);
  if (result.audio) void audio.playCommentary(result.audio);
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
  updateMovingObstacles(obstacles, game.time);
  stepBike(b, input, terrain, obstacles, DT);
  if (b.airborne && b.doubleJumped) game.airDoubleJumped = true;
  if (!b.crashed) {
    pickups.forEach((pickup, index) => {
      if (
        pickup.taken ||
        Math.hypot(b.x - pickup.x, b.z - pickup.z) >= PICKUP_RADIUS ||
        b.y - terrain.heightAt(pickup.x, pickup.z) >= PICKUP_REACH
      ) {
        return;
      }
      applyPickup(b, pickup.type);
      pickup.taken = true;
      world.setPickupVisible(index, false);
      flash(
        pickup.type === 'coffee' ? 'Coffee! 2x speed' : 'Energy drink! Double jump',
      );
      audio.event('pickup', pickup.type);
    });
  }
  if (b.foliageHit) dust.leafBurst(b.foliageHit);
  game.time += DT;
  if (!game.leaderboardWarmed && -b.z / terrain.courseLength >= 0.8) {
    game.leaderboardWarmed = true;
    void getLeaderboard();
  }
  if (b.landingImpact > 0) {
    game.trauma = Math.min(
      1,
      game.trauma + Math.max(0, Math.min(1, (b.landingImpact - 4) / 7)),
    );
  }
  if (b.airborne) {
    game.airTime += DT;
    game.airPeak = Math.max(
      game.airPeak,
      b.y - terrain.heightAt(b.x, b.z),
    );
    game.maxHeight = Math.max(game.maxHeight, game.airPeak);
  }
  game.maxAir = Math.max(game.maxAir, game.airTime);
  if (!wasAir && b.airborne) {
    const kicker = terrain.kickers.find((item) => Math.abs(item.z - b.z) < 8);
    if (kicker) audio.event('kicker', b.v);
  }
  if (wasAir && !b.airborne && !b.crashed) {
    audio.event('land');
    const air = game.airDoubleJumped ? 0 : airTimeBonus(game.airTime);
    const height = heightBonus(game.airPeak);
    const bonus = Math.round((air + height) * 10) / 10;
    game.bonus = Math.round((game.bonus + bonus) * 10) / 10;
    if (height > 0) {
      flash(
        `Huge air ${Math.round(game.airPeak)} m  -${bonus.toFixed(1)}s`,
        1500,
      );
    } else if (air > 0) {
      flash(`Big air -${bonus.toFixed(1)}s`, 1200);
    }
  }
  if (!b.airborne) {
    game.airTime = 0;
    game.airPeak = 0;
    game.airDoubleJumped = false;
  }
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
    game.crashes += 1;
    if (b.crashed === 'rock') game.otterHits += 1;
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
    const total = game.time + game.penalty - game.bonus;
    const isBest = !game.best || total < game.best;
    if (isBest) {
      game.best = total;
      localStorage.setItem('downhill-best-900', String(total));
    }
    audio.event('finish');
    if (isBest) audio.event('best');
    showOverlay(
      isBest ? 'New best' : 'Finished',
      `${total.toFixed(2)} s  (penalties ${game.penalty} s, air bonus ${game.bonus.toFixed(1)} s)  top ${Math.round(game.maxSpeed * 3.6)} km/h  best ${game.best.toFixed(2)} s`,
      'Ride again',
    );
    ui.finishForm.hidden = false;
    ui.finishLeaderboard.hidden = true;
    ui.nameInput.value = localStorage.getItem('downhill-name') || 'Rider';
    ui.finishLeaderboard.replaceChildren();
    getCommentary({ ...makeRunStats(ui.nameInput.value.trim() || 'Rider'), rank: null }).then(showCommentary);
  }
}

const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 65 };
const render = { x: 0, y: 0, z: 0, heading: 0, lean: 0 };
const waveCameraPos = new THREE.Vector3();
const waveCameraLook = new THREE.Vector3();
let waveOtter = null;
let waveStartedAt = 0;
let waveBikeState = null;

function startWave(result, playerRun) {
  if (game.mode !== 'finished' || game.waveMode) return;
  renderRankOverlay(
    ui.waveLeaderboard,
    buildRankOverlayRows(result?.top, result?.rank, playerRun),
  );
  const rival = rivalLine(result?.top, result?.rank);
  ui.waveRivalLine.textContent = rival || '';
  ui.waveRivalLine.hidden = !rival;
  ui.wavePanel.hidden = false;
  ui.waveBadge.hidden = false;
  ui.hud.classList.add('wave-mode');
  ui.touch.hidden = true;
  const bike = game.bike;
  const heading = bike.heading;
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = Math.sin(heading);
  waveBikeState = { v: bike.v, vy: bike.vy, airborne: bike.airborne };
  bike.v = 0;
  bike.vy = 0;
  bike.airborne = false;
  game.prev = snapshot(bike);
  model.root.position.set(bike.x, bike.y, bike.z);
  waveCameraPos.set(bike.x + fx * 4, bike.y + 1.55, bike.z + fz * 4);
  waveCameraLook.set(
    bike.x + rightX * 0.55,
    bike.y + 0.85,
    bike.z + rightZ * 0.55,
  );
  if (!waveOtter) waveOtter = world.createWaveOtter();
  if (waveOtter) {
    const otterX = bike.x + rightX * 1.5;
    const otterZ = bike.z + rightZ * 1.5;
    waveOtter.position.set(otterX, terrain.heightAt(otterX, otterZ), otterZ);
    waveOtter.rotation.y = Math.atan2(
      waveCameraPos.x - otterX,
      waveCameraPos.z - otterZ,
    );
    waveOtter.scale.setScalar(1.2);
    scene.add(waveOtter);
  }
  game.waveMode = true;
  waveStartedAt = performance.now();
  model.setWavePose(true, 0);
  ui.overlay.classList.add('hidden');
  camera.position.copy(waveCameraPos);
  camera.lookAt(waveCameraLook);
  camera.fov = 48;
  camera.updateProjectionMatrix();
}

function endWave() {
  if (!game.waveMode) return;
  game.waveMode = false;
  ui.wavePanel.hidden = true;
  ui.waveBadge.hidden = true;
  ui.hud.classList.remove('wave-mode');
  ui.touch.hidden = false;
  if (waveOtter) {
    scene.remove(waveOtter);
    world.disposeWaveOtter(waveOtter);
    waveOtter = null;
  }
  if (waveBikeState) {
    game.bike.v = waveBikeState.v;
    game.bike.vy = waveBikeState.vy;
    game.bike.airborne = waveBikeState.airborne;
    waveBikeState = null;
  }
  game.prev = snapshot(game.bike);
  model.setWavePose(false, 0);
  camera.fov = cam.fov;
  cameraTarget(cam.pos, cam.look);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  camera.updateProjectionMatrix();
  ui.overlay.classList.remove('hidden');
}

function showMenu() {
  if (game.waveMode) endWave();
  closeLeaderboard(false);
  const p = startPose();
  game.mode = 'ready';
  placeBike(p.x, p.z, p.heading, 0);
  resetPickups();
  clearPowerUps();
  game.time = 0;
  game.penalty = 0;
  game.bonus = 0;
  game.checkpoint = -1;
  game.crashTimer = 0;
  game.maxSpeed = 0;
  game.airTime = 0;
  game.airPeak = 0;
  game.airDoubleJumped = false;
  game.maxAir = 0;
  game.maxHeight = 0;
  game.crashes = 0;
  game.otterHits = 0;
  game.timeScale = 1;
  game.trauma = 0;
  game.crashedSinceCheckpoint = false;
  game.runId += 1;
  game.runSubmitted = false;
  game.runSubmitting = false;
  game.leaderboardWarmed = false;
  slowMoRealTime = 0;
  slowMoLocked = false;
  ghostRecorder.reset();
  model.resetCrash();
  updateMovingObstacles(obstacles, 0);
  world.update(0);
  ui.finishForm.hidden = true;
  ui.nameInput.disabled = false;
  ui.submitButton.disabled = false;
  ui.submitButton.textContent = 'Submit';
  ui.finishLeaderboard.hidden = true;
  ui.finishLeaderboard.replaceChildren();
  ui.leaderboardFinish.hidden = true;
  ui.wavePanel.hidden = true;
  ui.hud.classList.remove('wave-mode');
  ui.touch.hidden = true;
  ui.title.textContent = 'Downhill';
  ui.body.textContent = '';
  ui.button.textContent = 'Press start';
  ui.overlay.classList.add('start');
  ui.overlay.classList.remove('hidden');
  syncYouTubeUi();
  ui.flash.classList.remove('show');
  ui.subtitle.classList.remove('show');
  snapCamera();
  void refreshStartBoard();
}

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
  const chaseDistance = 6.2 * (1 - 0.1 * Math.min(1, Math.max(0, game.bike.v) / 25));
  out.set(focus.x - fx * chaseDistance, focus.y + 2.5, focus.z - fz * chaseDistance);
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
  if (game.waveMode) {
    camera.position.copy(waveCameraPos);
    camera.lookAt(waveCameraLook);
    return;
  }
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
  const targetFov = 62 + Math.min(28, b.v * 0.9);
  cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-3 * dt));
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

function gradeAt(b) {
  const dx = Math.sin(b.heading) * 0.6;
  const dz = -Math.cos(b.heading) * 0.6;
  return (terrain.heightAt(b.x + dx, b.z + dz) - terrain.heightAt(b.x - dx, b.z - dz)) / 1.2;
}

function tintGhost() {
  ghostModel.root.traverse((object) => {
    if (object.isMesh) {
      const makeMaterial = (material) => {
        const ghostMaterial = material.clone();
        ghostMaterial.transparent = true;
        ghostMaterial.opacity = 0.35;
        ghostMaterial.depthWrite = false;
        ghostMaterial.emissive?.set(0x005160);
        if ('emissiveIntensity' in ghostMaterial) ghostMaterial.emissiveIntensity = 0.18;
        return ghostMaterial;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(makeMaterial)
        : makeMaterial(object.material);
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });
}

function updateHud() {
  const b = game.bike;
  touchControls.hidden = game.mode !== 'riding';
  ui.coffeeTimer.hidden = !(b.boostTime > 0);
  if (b.boostTime > 0) ui.coffeeTimer.textContent = `☕ 2x ${b.boostTime.toFixed(1)}`;
  ui.energyTimer.hidden = !(b.doubleJumpTime > 0);
  if (b.doubleJumpTime > 0) {
    ui.energyTimer.textContent = `⚡ Double jump ${b.doubleJumpTime.toFixed(1)}`;
  }
  ui.speed.textContent = String(Math.round(b.v * 3.6));
  ui.timer.textContent = (game.time + game.penalty - game.bonus).toFixed(2);
  const progress = Math.max(0, Math.min(1, -b.z / terrain.courseLength));
  ui.progress.style.width = `${progress * 100}%`;
  ui.progressPercent.textContent = `${Math.round(progress * 100)}%`;
  const ghostFrame = game.mode === 'riding' || game.mode === 'crashed'
    ? sampleGhost(bestGhost, game.time)
    : null;
  ui.ghostProgress.hidden = !ghostFrame;
  if (ghostFrame) {
    const ghostProgress = Math.max(0, Math.min(1, -ghostFrame.z / terrain.courseLength));
    ui.ghostProgress.style.left = `${ghostProgress * 100}%`;
  }
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
    input.jump = 0;
    jumpQueued = false;
    ghostRecorder.sample(game.time, game.bike);
    accumulator -= DT;
    steps += 1;
  }
  if (steps === 12) accumulator = 0;
  interpolate(accumulator / DT);
  model.root.position.set(render.x, render.y, render.z);
  const waveElapsed = game.waveMode ? (performance.now() - waveStartedAt) / 1000 : 0;
  model.setWavePose(game.waveMode, waveElapsed);
  if (game.waveMode && waveOtter) {
    const waveAmount = Math.max(0, Math.min(1, (waveElapsed - 1.5) / 0.35));
    world.updateWaveOtter(waveOtter, waveElapsed, waveAmount);
  }
  model.update(
    { ...game.bike, heading: render.heading, lean: render.lean },
    game.mode === 'riding' ? input : {},
    gradeAt(game.bike),
    dt,
    terrain.heightAt,
  );
  const ghostFrame = ghostAssetsReady ? sampleGhost(bestGhost, game.time) : null;
  if (ghostFrame) {
    const nextFrame = sampleGhost(bestGhost, game.time + bestGhost.dt);
    const ghostSpeed = nextFrame
      ? Math.hypot(nextFrame.x - ghostFrame.x, nextFrame.z - ghostFrame.z) / bestGhost.dt
      : 0;
    ghostModel.root.visible = true;
    ghostModel.root.position.set(ghostFrame.x, ghostFrame.y, ghostFrame.z);
    ghostModel.update(
      {
        ...ghostFrame,
        v: ghostSpeed,
        vy: 0,
        airborne: false,
        steer: 0,
      },
      {},
      gradeAt(ghostFrame),
      dt,
      terrain.heightAt,
    );
  } else {
    ghostModel.root.visible = false;
  }
  world.followSun(model.root.position);
  world.update(game.time, camera.position, game.bike.v, game.quality >= 2);
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
function clonedAsset(gltf, skeleton = false) {
  return {
    ...gltf,
    scene: skeleton ? cloneSkeleton(gltf.scene) : gltf.scene.clone(true),
  };
}

async function applySelectedRider() {
  if (!baseModels?.['rider-body'] || !baseModels['bike-frame'] || !baseModels['bike-wheel']) {
    syncRiderUi(false);
    return false;
  }
  const version = ++riderLoadVersion;
  syncRiderUi(true);
  let chosen = null;
  try {
    chosen = await loadModel(`rider-${selectedRider}`);
  } catch {
    chosen = baseModels['rider-body'];
  }
  const backPrint = selectedRider === 'red' ? await backPrintPromise.catch(() => null) : null;
  if (version !== riderLoadVersion) return false;
  const riderApplied = model.setAssets({
    riderBody: clonedAsset(chosen, true),
    bikeFrame: clonedAsset(baseModels['bike-frame']),
    bikeWheel: clonedAsset(baseModels['bike-wheel']),
    backPrint,
  });
  ghostAssetsReady = Boolean(riderApplied && ghostModel.setAssets({
    riderBody: clonedAsset(chosen, true),
    bikeFrame: clonedAsset(baseModels['bike-frame']),
    bikeWheel: clonedAsset(baseModels['bike-wheel']),
    backPrint,
  }));
  if (ghostAssetsReady) tintGhost();
  game.ghostAssetsReady = ghostAssetsReady;
  assetsReady = Boolean(riderApplied);
  game.assetsReady = assetsReady;
  syncRiderUi(false);
  return riderApplied;
}
if (debug) {
  game.assetStatus = { state: 'loading', loaded: [], missing: [] };
  window.__assetLoadErrors = {};
  window.__riderModel = model;
}
loadModels(modelNames).then(async (models) => {
  if (debug) window.__models = models;
  baseModels = models;
  world.applyModels(models);
  const riderApplied = await applySelectedRider();
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
void refreshStartBoard();
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
