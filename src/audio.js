const BASE = './assets/audio/';
const LOOPS = ['tire-gravel-loop', 'wind-loop', 'freewheel-loop', 'pedal-loop', 'forest-loop'];
const ONESHOTS = ['brake-skid', 'crash', 'land', 'checkpoint', 'finish-cheer', 'vo-go', 'vo-clean', 'vo-air', 'vo-crash', 'vo-checkpoint', 'vo-best', 'vo-send'];

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  const buffers = {};
  const loops = {};
  let muted = localStorage.getItem('downhill-muted') === '1';
  let lastVoice = 0;
  let skidCooldown = 0;

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

  return {
    get muted() { return muted; },
    async unlock() {
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      await Promise.all([...LOOPS, ...ONESHOTS, 'music-ride'].map(load));
      for (const name of LOOPS) startLoop(name);
      setLoop('forest-loop', 0.35);
      if (buffers['music-ride']) {
        const source = ctx.createBufferSource();
        source.buffer = buffers['music-ride'];
        source.loop = true;
        musicGain = ctx.createGain();
        musicGain.gain.value = 0.18;
        source.connect(musicGain).connect(master);
        source.start();
      }
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('downhill-muted', muted ? '1' : '0');
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
      return muted;
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
      skidCooldown -= dt;
      if (grounded && skidCooldown <= 0 && ((bike.brake > 0.8 && v > 6) || (bike.slipping && v > 7))) {
        play('brake-skid', 0.6);
        skidCooldown = 1.2;
      }
    },
    event(name) {
      if (!ctx) return;
      const now = ctx.currentTime;
      const voice = (line, chance = 1) => {
        if (now - lastVoice < 3 || Math.random() > chance) return;
        lastVoice = now;
        play(line, 0.9);
      };
      if (name === 'start') voice('vo-go');
      if (name === 'checkpoint') { play('checkpoint', 0.5); voice('vo-checkpoint', 0.5); }
      if (name === 'land') play('land', 0.8);
      if (name === 'big-air') voice('vo-air');
      if (name === 'crash') { play('crash', 0.9); voice('vo-crash', 0.7); }
      if (name === 'finish') play('finish-cheer', 0.8);
      if (name === 'best') voice('vo-best');
    },
  };
}
