const BASE = './assets/audio/';
const LOOPS = ['tire-gravel-loop', 'wind-loop', 'freewheel-loop', 'pedal-loop', 'forest-loop', 'brake-skid'];
const ONESHOTS = ['crash', 'otter-hit', 'land', 'checkpoint', 'finish-cheer', 'vo-go', 'vo-clean', 'vo-air', 'vo-crash', 'vo-ottified', 'vo-checkpoint', 'vo-best', 'vo-send'];
const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let voiceSource = null;
  const buffers = {};
  const loops = {};
  const storedMute = localStorage.getItem('downhill-muted');
  let muted = storedMute === '1';
  const storedVolume = localStorage.getItem('downhill-volume');
  let volume = storedVolume === null || storedVolume.trim() === '' ? 0.8 : Number(storedVolume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) volume = 0.8;
  async function load(name) {
    try {
      const res = await fetch(`${BASE}${name}.mp3`);
      if (!res.ok) return;
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      // Missing assets are fine during development.
    }
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

  return {
    get muted() { return muted; },
    get volume() { return volume; },
    async unlock() {
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      await Promise.all([...LOOPS, ...ONESHOTS, 'music-ride'].map(load));
      for (const name of LOOPS) startLoop(name);
      setLoop('forest-loop', 0.35);
      if (buffers['music-ride']) {
        const source = ctx.createBufferSource();
        source.buffer = buffers['music-ride'];
        source.loop = true;
        musicGain = ctx.createGain();
        musicGain.gain.value = 0.25;
        source.connect(musicGain).connect(master);
        source.start();
      }
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('downhill-muted', muted ? '1' : '0');
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
      return muted;
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      localStorage.setItem('downhill-volume', String(volume));
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
      return volume;
    },
    update(bike, input, riding, dt) {
      if (!ctx) return;
      const v = riding ? bike.v : 0;
      const grounded = riding && !bike.airborne;
      const speed01 = Math.min(1, v / 20);
      setLoop('tire-gravel-loop', grounded ? 0.15 + speed01 * 0.6 : 0, 0.8 + speed01 * 0.5);
      setLoop('wind-loop', riding ? speed01 * speed01 * 0.8 : 0, 0.85 + speed01 * 0.35);
      setLoop('pedal-loop', grounded && input.throttle ? 0.45 : 0, 0.9 + speed01 * 0.4);
      setLoop('freewheel-loop', grounded && !input.throttle && v > 1 ? 0.18 : 0, 0.8 + speed01 * 0.6);
      const skid = grounded ? Math.max(clamp01(bike.brake), bike.slipping ? 0.8 : 0) : 0;
      setLoop('brake-skid', 0.35 * skid * speed01, 0.9 + speed01 * 0.3);
    },
    event(name, value) {
      if (!ctx) return;
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
