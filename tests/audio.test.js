import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createAudio, getMusicGainTarget } from '../src/audio.js';

class FakeDocument {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener),
    );
  }

  dispatch(type) {
    for (const entry of [...(this.listeners.get(type) || [])]) {
      if (entry.once) this.removeEventListener(type, entry.listener);
      entry.listener({ type });
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 2;
    this.destination = {};
    this.listeners = new Map();
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.callOrder = [];
    this.startedBuffers = [];
    this.gains = [];
    FakeAudioContext.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }

  createGain() {
    const gain = {
      gain: {
        value: 1,
        setTargetAtTime() {},
        setValueAtTime() {},
        cancelScheduledValues() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect: (node) => node,
    };
    this.gains.push(gain);
    return gain;
  }

  createBuffer(_channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }

  decodeAudioData(data) {
    return Promise.resolve({ name: data });
  }

  createBufferSource() {
    const source = {
      buffer: null,
      loop: false,
      playbackRate: { value: 1, setTargetAtTime() {} },
      connect: (node) => node,
      start: () => this.startedBuffers.push(source.buffer),
      stop() {},
      addEventListener() {},
    };
    return source;
  }

  createBiquadFilter() {
    return {
      type: '',
      frequency: { value: 0 },
      Q: { value: 0 },
      connect: (node) => node,
    };
  }

  suspend() {
    this.suspendCalls += 1;
    this.callOrder.push('suspend');
    return new Promise((resolve) => {
      this.resolveSuspend = () => {
        this.state = 'suspended';
        resolve();
        this.dispatch('statechange');
      };
    });
  }

  resume() {
    this.resumeCalls += 1;
    this.callOrder.push('resume');
    return new Promise((resolve) => {
      this.resolveResume = () => {
        this.state = 'running';
        resolve();
        this.dispatch('statechange');
      };
    });
  }
}

describe('createAudio context recovery', () => {
  let documentStub;

  beforeEach(() => {
    FakeAudioContext.instances = [];
    documentStub = new FakeDocument();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('fetch', async () => ({ ok: false }));
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem() {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resumes if resume is requested while suspend is still pending', async () => {
    const audio = createAudio();
    await audio.unlock();
    const context = FakeAudioContext.instances[0];

    const suspendPromise = audio.suspend();
    const resumePromise = audio.resume();
    context.resolveSuspend();
    await vi.waitFor(() => expect(context.resumeCalls).toBe(1));

    context.resolveResume();
    await Promise.all([suspendPromise, resumePromise]);
    expect(context.state).toBe('running');
  });

  it('resumes an interrupted context once on the next user gesture', async () => {
    const audio = createAudio();
    await audio.unlock();
    const context = FakeAudioContext.instances[0];
    context.state = 'interrupted';
    context.dispatch('statechange');
    context.dispatch('statechange');

    expect(documentStub.listenerCount('pointerdown')).toBe(1);
    documentStub.dispatch('pointerdown');
    expect(context.resumeCalls).toBe(1);
    documentStub.dispatch('pointerdown');
    expect(context.resumeCalls).toBe(1);

    context.resolveResume();
    expect(context.state).toBe('running');
  });

  it('keeps an interrupted context suspended when pause follows a resume gesture', async () => {
    const audio = createAudio();
    await audio.unlock();
    const context = FakeAudioContext.instances[0];
    context.state = 'interrupted';
    context.dispatch('statechange');
    documentStub.dispatch('pointerdown');

    const suspendPromise = audio.suspend();
    expect(context.callOrder).toEqual(['resume', 'suspend']);
    expect(context.suspendCalls).toBe(1);

    context.resolveResume();
    context.resolveSuspend();
    await suspendPromise;
    expect(context.state).toBe('suspended');
  });

  it('starts only one selected music source when the track changes during unlock', async () => {
    let resolveLoFi;
    vi.stubGlobal('fetch', async (url) => {
      if (url.endsWith('music-lofi.mp3')) {
        return new Promise((resolve) => {
          resolveLoFi = () => resolve({ ok: true, arrayBuffer: async () => url });
        });
      }
      return { ok: true, arrayBuffer: async () => url };
    });

    const audio = createAudio();
    const unlockPromise = audio.unlock();
    audio.setMusic('music-lofi');
    await vi.waitFor(() => expect(resolveLoFi).toBeTypeOf('function'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveLoFi();
    await unlockPromise;

    const context = FakeAudioContext.instances[0];
    expect(context.startedBuffers.filter((buffer) => buffer?.name === './assets/audio/music-lofi.mp3')).toHaveLength(1);
  });

  it('selects playback audio session mode when available', async () => {
    const audioSession = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession });

    await createAudio().unlock();

    expect(audioSession.type).toBe('playback');
  });

  it('keeps the master gain muted when title audio unlocks', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key) => (key === 'downhill-muted' ? '1' : null),
      setItem() {},
    });

    const audio = createAudio();
    await audio.unlock();

    expect(FakeAudioContext.instances[0].gains[0].gain.value).toBe(0);
  });
});

describe('getMusicGainTarget', () => {
  it('mutes the built-in track when Sound is off', () => {
    expect(getMusicGainTarget(0.25, {
      muted: true,
      selectedMusic: 'music-ride',
      youtubePlaying: false,
    })).toBe(0);
  });

  it('mutes the built-in track while YouTube is playing', () => {
    expect(getMusicGainTarget(0.25, {
      muted: false,
      selectedMusic: 'youtube',
      youtubePlaying: true,
    })).toBe(0);
  });

  it('restores the requested level when YouTube is paused and Sound is on', () => {
    expect(getMusicGainTarget(0.1, {
      muted: false,
      selectedMusic: 'youtube',
      youtubePlaying: false,
    })).toBe(0.1);
  });
});
