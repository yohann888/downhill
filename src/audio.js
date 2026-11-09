import { parseYouTubeId } from './youtube.js';
import { crashVariant, landingSound, pickTake, tireMix } from './sfx-mix.js';

const BASE = './assets/audio/';
const LOOPS = ['tire-gravel-loop', 'tire-dirt-loop', 'tire-grass-loop', 'wind-loop', 'freewheel-loop', 'pedal-loop', 'forest-loop', 'brake-skid'];
const VOICE_LINES = ['vo-go', 'vo-clean', 'vo-air', 'vo-crash', 'vo-ottified', 'vo-checkpoint', 'vo-best', 'vo-send'];
const VOICE_TAKES = Object.fromEntries(VOICE_LINES.map((name) => [name, [name, `${name}-2`, `${name}-3`]]));
const ONESHOTS = ['crash', 'otter-hit', 'land', 'checkpoint', 'finish-cheer', ...Object.values(VOICE_TAKES).flat()];
const MUSIC_TRACKS = [
  { id: 'music-ride', label: 'Space trance' },
  { id: 'music-lofi', label: 'Lo-fi' },
  { id: 'music-punk', label: 'Punk' },
  { id: 'music-rain', label: 'Rain' },
  { id: 'music-synthwave', label: 'Synthwave' },
  { id: 'youtube', label: 'YouTube', youtubeOnly: true },
];
const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function getMusicGainTarget(target, { muted, selectedMusic, youtubePlaying }) {
  return muted || (selectedMusic === 'youtube' && youtubePlaying) ? 0 : target;
}

export function createAudio() {
  let ctx = null;
  let unlockReady = null;
  let wantRunning = true;
  let resumeGestureArmed = false;
  let master = null;
  let musicGain = null;
  let musicSource = null;
  let musicSourceVersion = -1;
  let rainNodes = null;
  let rainSelected = false;
  let previousMusic = 'music-ride';
  let youtubePlaying = false;
  let voiceSource = null;
  const lastTake = {};
  let reverbSend = null;
  let noiseBuffer = null;
  const buffers = {};
  const loops = {};
  const loading = {};
  const storedMusic = localStorage.getItem('downhill.music');
  let selectedMusic = MUSIC_TRACKS.some((track) => track.id === storedMusic)
    ? storedMusic
    : MUSIC_TRACKS[0].id;
  let musicSelectionVersion = 0;
  let musicRateScale = 1;
  const resumeEvents = ['pointerdown', 'touchend', 'keydown'];
  const storedMute = localStorage.getItem('downhill-muted');
  let muted = storedMute === '1';
  const storedVolume = localStorage.getItem('downhill-volume');
  let volume = storedVolume === null || storedVolume.trim() === '' ? 0.8 : Number(storedVolume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) volume = 0.8;
  function load(name) {
    if (buffers[name]) return Promise.resolve(buffers[name]);
    if (loading[name]) return loading[name];
    loading[name] = (async () => {
      try {
        const res = await fetch(`${BASE}${name}.mp3`);
        if (!res.ok) return null;
        buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
        return buffers[name];
      } catch {
        return null;
      } finally {
        delete loading[name];
      }
    })();
    return loading[name];
  }

  async function switchMusic(name, version) {
    if (name === 'youtube') return;
    const buffer = await load(name);
    if (!buffer || !ctx || version !== musicSelectionVersion || name !== selectedMusic || musicSourceVersion === version) return;
    const now = ctx.currentTime;
    const previousSource = musicSource;
    const previousGain = musicGain;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = musicRateScale;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    source.connect(gain).connect(master);
    source.start(now);
    if (previousGain && previousSource) {
      previousGain.gain.cancelScheduledValues(now);
      previousGain.gain.setValueAtTime(previousGain.gain.value, now);
      previousGain.gain.linearRampToValueAtTime(0, now + 0.5);
      previousSource.stop(now + 0.51);
    }
    musicSource = source;
    musicSourceVersion = version;
    musicGain = gain;
    setMusicGain(voiceSource ? 0.1 : 0.25, 0.08);
  }

  function setMusicGain(target = voiceSource ? 0.1 : 0.25, timeConstant = 0.08) {
    if (!musicGain || !ctx) return;
    const gain = getMusicGainTarget(target, { muted, selectedMusic, youtubePlaying });
    musicGain.gain.setTargetAtTime(gain, ctx.currentTime, timeConstant);
  }

  function startLoop(name, gainValue = 0) {
    const buffer = buffers[name];
    if (!buffer || loops[name]) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(gain).connect(master);
    source.start();
    loops[name] = { source, gain };
  }

  function setLoop(name, volume, rate = 1) {
    const loop = loops[name];
    if (!loop) return;
    const t = ctx.currentTime;
    loop.gain.gain.setTargetAtTime(volume, t, 0.08);
    loop.source.playbackRate.setTargetAtTime(rate, t, 0.1);
  }

  function connectOut(node, send = 0, pan = 0) {
    let out = node;
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      out = node.connect(panner);
    }
    out.connect(master);
    if (send > 0 && reverbSend) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      out.connect(sendGain).connect(reverbSend);
    }
  }

  function play(name, volume = 1, { rate = 1, offset = 0, send = 0.1, pan = 0 } = {}) {
    const buffer = buffers[name];
    if (!ctx || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    connectOut(source.connect(gain), send, pan);
    source.start(0, offset);
  }

  function createReverb() {
    if (!ctx.createConvolver) return;
    const seconds = 1.8;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * (1 - t) ** 3.2 * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(convolver).connect(tone).connect(wet).connect(master);
  }

  function playWhoosh({ pan = 0, volume = 0.3, rate = 1 }) {
    if (!ctx || !noiseBuffer) return;
    const start = ctx.currentTime;
    const length = 0.34 / rate;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(700 * rate, start);
    band.frequency.exponentialRampToValueAtTime(2600 * rate, start + length * 0.35);
    band.frequency.exponentialRampToValueAtTime(500 * rate, start + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    connectOut(source.connect(band).connect(gain), 0.15, pan);
    source.start(start, Math.random());
    source.stop(start + length + 0.05);
  }

  function playThump(amount) {
    if (!ctx || amount <= 0) return;
    const start = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(95, start);
    oscillator.frequency.exponentialRampToValueAtTime(38, start + 0.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.55 * amount, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  }

  function playVoice(line) {
    const name = pickTake((VOICE_TAKES[line] || [line]).filter((take) => buffers[take]), lastTake[line]);
    lastTake[line] = name;
    const buffer = buffers[name];
    if (!ctx || !buffer) return;
    if (voiceSource) {
      try { voiceSource.stop(); } catch { /* already ended */ }
    }
    const source = ctx.createBufferSource();
    voiceSource = source;
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    connectOut(source.connect(gain), 0.06);
    source.addEventListener('ended', () => {
      if (voiceSource === source) voiceSource = null;
    }, { once: true });
    source.start();
  }

  function playPickup(type) {
    if (!ctx || !master) return;
    const frequencies =
      type === 'coffee' ? [660, 990] : [440, 660, 880, 1320];
    const spacing = type === 'coffee' ? 0.11 : 0.065;
    frequencies.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * spacing;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      oscillator.connect(gain).connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.11);
    });
  }

  function playChime(ahead) {
    if (!ctx || !master) return;
    const frequencies = ahead ? [523.25, 783.99] : [783.99, 523.25];
    frequencies.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.12;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      oscillator.connect(gain).connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.11);
    });
  }

  function playSqueak() {
    if (!ctx || !master) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(420, start);
    oscillator.frequency.exponentialRampToValueAtTime(880, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  }

  function createRainNoise() {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
    const highSource = ctx.createBufferSource();
    highSource.buffer = buffer;
    highSource.loop = true;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 4300;
    bandpass.Q.value = 0.45;
    const highGain = ctx.createGain();
    highGain.gain.value = 0;
    highSource.connect(bandpass).connect(highGain).connect(master);
    highSource.start();
    const lowSource = ctx.createBufferSource();
    lowSource.buffer = buffer;
    lowSource.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 150;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0;
    lowSource.connect(lowpass).connect(lowGain).connect(master);
    lowSource.start();
    rainNodes = { highGain, lowGain };
  }

  function resumeFromGesture() {
    for (const type of resumeEvents) {
      document.removeEventListener(type, resumeFromGesture, true);
    }
    resumeGestureArmed = false;
    if (wantRunning && ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      ctx.resume().catch(() => {});
    }
  }

  function armResumeGesture() {
    if (resumeGestureArmed || typeof document === 'undefined') return;
    resumeGestureArmed = true;
    for (const type of resumeEvents) {
      document.addEventListener(type, resumeFromGesture, { once: true, capture: true });
    }
  }

  async function playCommentary(base64) {
    if (!ctx || !master || !base64) return false;
    let source = null;
    const restoreMusic = () => setMusicGain();
    try {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      if (voiceSource) {
        try { voiceSource.stop(); } catch { /* already ended */ }
      }
      source = ctx.createBufferSource();
      source.buffer = buffer;
      voiceSource = source;
      source.connect(master);
      setMusicGain(0.1);
      source.addEventListener('ended', () => {
        if (voiceSource === source) {
          voiceSource = null;
          restoreMusic();
        }
      }, { once: true });
      source.start();
      return true;
    } catch {
      restoreMusic();
      return false;
    }
  }

  return {
    get muted() { return muted; },
    get volume() { return volume; },
    async unlock() {
      wantRunning = true;
      if (ctx) {
        if (ctx.state !== 'running' && ctx.state !== 'closed') await ctx.resume().catch(() => {});
        return unlockReady;
      }
      try {
        if (typeof navigator !== 'undefined' && navigator.audioSession) {
          navigator.audioSession.type = 'playback';
        }
      } catch {}
      ctx = new AudioContext();
      ctx.addEventListener('statechange', () => {
        if (wantRunning && ctx.state !== 'running' && ctx.state !== 'closed') {
          armResumeGesture();
        }
      });
      if (ctx.state !== 'running' && ctx.state !== 'closed') armResumeGesture();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      if (ctx.createDynamicsCompressor) {
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 4;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.2;
        master.connect(limiter).connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
      createReverb();
      createRainNoise();
      unlockReady = (async () => {
        await Promise.all([...LOOPS, ...ONESHOTS].map(load));
        for (const name of LOOPS) startLoop(name);
        setLoop('forest-loop', 0.35);
        if (!musicSource) {
          const version = musicSelectionVersion;
          await load(selectedMusic);
          await switchMusic(selectedMusic, version);
        }
      })();
      return unlockReady;
    },
    async suspend() {
      wantRunning = false;
      if (ctx && ctx.state !== 'closed') {
        await ctx.suspend().catch(() => {});
        if (wantRunning) await ctx.resume().catch(() => {});
      }
    },
    async resume() {
      wantRunning = true;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        await ctx.resume().catch(() => {});
      }
    },
    get music() {
      return MUSIC_TRACKS.find((track) => track.id === selectedMusic);
    },
    get previousMusic() {
      return MUSIC_TRACKS.find((track) => track.id === previousMusic) || MUSIC_TRACKS[0];
    },
    tracks: MUSIC_TRACKS,
    nextMusic() {
      const tracks = MUSIC_TRACKS.filter((track) => !track.youtubeOnly || parseYouTubeId(localStorage.getItem('downhill.youtube-link')));
      const availableIndex = tracks.findIndex((track) => track.id === selectedMusic);
      return this.setMusic(tracks[(availableIndex + 1) % tracks.length].id);
    },
    setMusic(id) {
      if (!MUSIC_TRACKS.some((track) => track.id === id)) return this.music;
      if (id === selectedMusic) return this.music;
      if (selectedMusic !== 'youtube') previousMusic = selectedMusic;
      selectedMusic = id;
      if (id !== 'youtube') youtubePlaying = false;
      rainSelected = id === 'music-rain';
      localStorage.setItem('downhill.music', selectedMusic);
      musicSelectionVersion += 1;
      if (ctx) void switchMusic(selectedMusic, musicSelectionVersion);
      if (musicGain && id === 'youtube') {
        setMusicGain();
      }
      return MUSIC_TRACKS.find((track) => track.id === selectedMusic);
    },
    setYouTubePlaying(playing) {
      youtubePlaying = Boolean(playing);
      if (selectedMusic === 'youtube') setMusicGain();
    },
    setRain(active) {
      rainSelected = Boolean(active) && selectedMusic === 'music-rain';
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('downhill-muted', muted ? '1' : '0');
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
      setMusicGain();
      return muted;
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      localStorage.setItem('downhill-volume', String(volume));
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
      return volume;
    },
    playCommentary,
    chime(ahead) {
      playChime(Boolean(ahead));
    },
    squeak() {
      playSqueak();
    },
    update(bike, input, riding, dt, timeScale = 1, offTrail = 0) {
      if (!ctx) return;
      const v = riding ? bike.v : 0;
      const grounded = riding && !bike.airborne;
      const speed01 = Math.min(1, v / 20);
      const playbackRateScale = timeScale < 0.999 ? 0.85 : 1;
      const rate = (base) => base * playbackRateScale;
      musicRateScale = playbackRateScale;
      if (rainNodes) {
        const rainVolume = rainSelected && riding ? 0.08 : 0;
        rainNodes.highGain.gain.setTargetAtTime(rainVolume * 0.78, ctx.currentTime, 0.15);
        rainNodes.lowGain.gain.setTargetAtTime(rainVolume * 0.22, ctx.currentTime, 0.15);
      }
      if (musicSource) {
        musicSource.playbackRate.setTargetAtTime(playbackRateScale, ctx.currentTime, 0.1);
      }
      setLoop('forest-loop', 0.35, playbackRateScale);
      const tires = tireMix(grounded ? 0.15 + speed01 * 0.6 : 0, offTrail);
      const tireRate = rate(0.8 + speed01 * 0.5);
      setLoop('tire-gravel-loop', tires.gravel, tireRate);
      setLoop('tire-dirt-loop', tires.dirt, tireRate);
      setLoop('tire-grass-loop', tires.grass, tireRate);
      setLoop('wind-loop', riding ? speed01 * speed01 * 0.8 : 0, rate(0.85 + speed01 * 0.35));
      setLoop('pedal-loop', grounded && input.throttle ? 0.45 : 0, rate(0.9 + speed01 * 0.4));
      setLoop('freewheel-loop', grounded && !input.throttle && v > 1 ? 0.18 : 0, rate(0.8 + speed01 * 0.6));
      const skid = grounded
        ? Math.max(
            clamp01(bike.brake),
            bike.slipping ? 0.8 : 0,
            clamp01(bike.skid || 0),
          )
        : 0;
      setLoop('brake-skid', 0.35 * skid * speed01, rate(0.9 + speed01 * 0.3));
    },
    event(name, value) {
      if (!ctx) return;
      if (name === 'pickup') playPickup(value);
      if (name === 'start') playVoice('vo-go');
      if (name === 'checkpoint') {
        play('checkpoint', 0.5, { send: 0.2 });
        playVoice(value ? 'vo-clean' : 'vo-checkpoint');
      }
      if (name === 'land') {
        const landing = landingSound(value || 0);
        play('land', landing.volume, landing);
        playThump(landing.thump);
      }
      if (name === 'whoosh') playWhoosh(value);
      if (name === 'kicker') playVoice(value > 12 ? 'vo-send' : 'vo-air');
      if (name === 'crash') {
        const isRock = value === 'rock';
        play(isRock ? 'otter-hit' : 'crash', 0.9, crashVariant());
        playVoice(isRock ? 'vo-ottified' : 'vo-crash');
      }
      if (name === 'finish') play('finish-cheer', 0.8, { send: 0.25 });
      if (name === 'best') playVoice('vo-best');
    },
  };
}
