import { parseYouTubeId } from './youtube.js';

const BASE = './assets/audio/';
const LOOPS = ['tire-gravel-loop', 'wind-loop', 'freewheel-loop', 'pedal-loop', 'forest-loop', 'brake-skid'];
const ONESHOTS = ['crash', 'otter-hit', 'land', 'checkpoint', 'finish-cheer', 'vo-go', 'vo-clean', 'vo-air', 'vo-crash', 'vo-ottified', 'vo-checkpoint', 'vo-best', 'vo-send'];
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
  let master = null;
  let musicGain = null;
  let musicSource = null;
  let rainNodes = null;
  let rainSelected = false;
  let previousMusic = 'music-ride';
  let youtubePlaying = false;
  let voiceSource = null;
  const buffers = {};
  const loops = {};
  const loading = {};
  const storedMusic = localStorage.getItem('downhill.music');
  let selectedMusic = MUSIC_TRACKS.some((track) => track.id === storedMusic)
    ? storedMusic
    : MUSIC_TRACKS[0].id;
  let musicSelectionVersion = 0;
  let musicRateScale = 1;
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
    if (!buffer || !ctx || version !== musicSelectionVersion || name !== selectedMusic) return;
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

  function play(name, volume = 1) {
    const buffer = buffers[name];
    if (!ctx || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(master);
    source.start();
  }

  function playVoice(name) {
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
    source.connect(gain).connect(master);
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

  function createRainNoise() {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
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
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      createRainNoise();
      await Promise.all([...LOOPS, ...ONESHOTS].map(load));
      for (const name of LOOPS) startLoop(name);
      setLoop('forest-loop', 0.35);
      if (!musicSource) {
        const version = musicSelectionVersion;
        await load(selectedMusic);
        await switchMusic(selectedMusic, version);
      }
    },
    async suspend() {
      if (ctx && ctx.state === 'running') await ctx.suspend();
    },
    async resume() {
      if (ctx && ctx.state === 'suspended') await ctx.resume();
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
    update(bike, input, riding, dt, timeScale = 1) {
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
      setLoop('tire-gravel-loop', grounded ? 0.15 + speed01 * 0.6 : 0, rate(0.8 + speed01 * 0.5));
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
        play('checkpoint', 0.5);
        playVoice(value ? 'vo-clean' : 'vo-checkpoint');
      }
      if (name === 'land') play('land', 0.8);
      if (name === 'kicker') playVoice(value > 12 ? 'vo-send' : 'vo-air');
      if (name === 'crash') {
        const isRock = value === 'rock';
        play(isRock ? 'otter-hit' : 'crash', 0.9);
        playVoice(isRock ? 'vo-ottified' : 'vo-crash');
      }
      if (name === 'finish') play('finish-cheer', 0.8);
      if (name === 'best') playVoice('vo-best');
    },
  };
}
