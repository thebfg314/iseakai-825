/** Preloaded one-shots. Fanfare/horn pause the music bed for their duration. */

export type MusicBedHandle = {
  paused: boolean;
  pause: () => void;
  play: () => void | Promise<void>;
};

export type OneShotOpts = {
  /** Pause the music bed until this cue ends; resume only if it was playing. */
  duckMusic?: boolean;
};

export type AudioLike = {
  src: string;
  volume: number;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  preload: string;
  play: () => Promise<void>;
  pause: () => void;
  load: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type AudioCtor = new (src?: string) => AudioLike;

type BufferSourceLike = {
  buffer: unknown;
  connect: (node: unknown) => void;
  start: (when?: number) => void;
  stop: () => void;
  onended: (() => void) | null;
};

type GainLike = {
  gain: { value: number };
  connect: (dest: unknown) => void;
};

export type AudioContextLike = {
  state: string;
  destination: unknown;
  resume: () => Promise<void>;
  createBufferSource: () => BufferSourceLike;
  createGain: () => GainLike;
  decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer>;
  close?: () => Promise<void>;
};

export type FetchLike = (url: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;

const POOL_SIZE = 4;
const OVERLAY_SAFETY_MS = 30_000;

export function createMusicDucker(getMusic: () => MusicBedHandle | null) {
  let holds = 0;
  let resumeAfter = false;

  return {
    get holding() {
      return holds > 0;
    },
    begin() {
      if (holds === 0) {
        const music = getMusic();
        resumeAfter = Boolean(music && !music.paused);
        if (resumeAfter && music) music.pause();
      }
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds = Math.max(0, holds - 1);
        if (holds === 0 && resumeAfter) {
          resumeAfter = false;
          const music = getMusic();
          if (music && music.paused) void Promise.resolve(music.play()).catch(() => undefined);
        }
      };
    },
    reset() {
      holds = 0;
      resumeAfter = false;
    },
  };
}

export type SfxPlayerDeps = {
  getMusic: () => MusicBedHandle | null;
  Audio?: AudioCtor;
  AudioContext?: new () => AudioContextLike;
  fetch?: FetchLike;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
};

export type SfxPlayer = {
  preload: (srcs: string[]) => void;
  unlock: () => void;
  play: (src: string, volume: number, opts?: OneShotOpts) => void;
  get holdingMusic(): boolean;
  dispose: () => void;
};

function defaultAudio(): AudioCtor | undefined {
  return typeof Audio === "undefined" ? undefined : (Audio as unknown as AudioCtor);
}

function defaultAudioContext(): (new () => AudioContextLike) | undefined {
  const w = typeof globalThis === "undefined" ? undefined : (globalThis as typeof globalThis & {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  });
  return w?.AudioContext ?? w?.webkitAudioContext;
}

function defaultFetch(): FetchLike | undefined {
  return typeof fetch === "undefined" ? undefined : (fetch as FetchLike);
}

export function createSfxPlayer(deps: SfxPlayerDeps): SfxPlayer {
  const AudioImpl = deps.Audio ?? defaultAudio();
  const ContextImpl = deps.AudioContext ?? defaultAudioContext();
  const fetchImpl = deps.fetch ?? defaultFetch();
  const setTo = deps.setTimeout ?? setTimeout;
  const clearTo = deps.clearTimeout ?? clearTimeout;
  const ducker = createMusicDucker(deps.getMusic);
  const pools = new Map<string, AudioLike[]>();
  const buffers = new Map<string, AudioBuffer>();
  const decoding = new Map<string, Promise<void>>();
  let ctx: AudioContextLike | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function context(): AudioContextLike | null {
    if (ctx) return ctx;
    if (!ContextImpl) return null;
    try {
      ctx = new ContextImpl();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function poolFor(src: string): AudioLike[] {
    let pool = pools.get(src);
    if (!pool) {
      pool = [];
      pools.set(src, pool);
    }
    if (!AudioImpl) return pool;
    while (pool.length < POOL_SIZE) {
      const el = new AudioImpl(src);
      el.preload = "auto";
      el.load();
      pool.push(el);
    }
    return pool;
  }

  function acquireHtml(src: string): AudioLike | null {
    if (!AudioImpl) return null;
    const pool = poolFor(src);
    return pool.find((el) => el.paused || el.ended) ?? pool[0] ?? null;
  }

  function decode(src: string) {
    const ac = context();
    if (!ac || !fetchImpl || buffers.has(src) || decoding.has(src)) return;
    const job = fetchImpl(src)
      .then((res) => res.arrayBuffer())
      .then((data) => ac.decodeAudioData(data))
      .then((buf) => {
        buffers.set(src, buf);
      })
      .catch(() => {
        /* HTML pool still works */
      })
      .finally(() => {
        decoding.delete(src);
      });
    decoding.set(src, job);
  }

  function playBuffer(src: string, volume: number, onDone?: () => void): boolean {
    const ac = context();
    const buf = buffers.get(src);
    if (!ac || !buf) return false;
    if (ac.state !== "running") {
      void ac.resume().catch(() => undefined);
      return false;
    }
    try {
      const gain = ac.createGain();
      gain.gain.value = Math.min(1, Math.max(0, volume));
      gain.connect(ac.destination);
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(gain);
      if (onDone) node.onended = onDone;
      node.start(0);
      return true;
    } catch {
      return false;
    }
  }

  function playHtml(src: string, volume: number, onDone?: () => void, dedicated?: boolean) {
    const el = dedicated && AudioImpl ? new AudioImpl(src) : acquireHtml(src);
    if (!el) {
      onDone?.();
      return;
    }
    el.volume = Math.min(1, Math.max(0, volume));
    try {
      el.currentTime = 0;
    } catch {
      /* some engines throw until metadata exists */
    }
    if (onDone) {
      const done = () => {
        el.removeEventListener("ended", done);
        el.removeEventListener("error", done);
        onDone();
      };
      el.addEventListener("ended", done);
      el.addEventListener("error", done);
    }
    void el.play().catch(() => {
      onDone?.();
    });
  }

  return {
    preload(srcs: string[]) {
      for (const src of srcs) {
        poolFor(src);
        decode(src);
      }
    },
    unlock() {
      const ac = context();
      if (ac && ac.state !== "running") void ac.resume().catch(() => undefined);
    },
    play(src: string, volume: number, opts?: OneShotOpts) {
      const duck = Boolean(opts?.duckMusic);
      const release = duck ? ducker.begin() : undefined;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        release?.();
      };
      if (duck) {
        const timer = setTo(() => {
          timers.delete(timer);
          done();
        }, OVERLAY_SAFETY_MS);
        timers.add(timer);
        const wrap = () => {
          clearTo(timer);
          timers.delete(timer);
          done();
        };
        if (!playBuffer(src, volume, wrap)) playHtml(src, volume, wrap, true);
        return;
      }
      if (!playBuffer(src, volume)) playHtml(src, volume);
      decode(src);
    },
    get holdingMusic() {
      return ducker.holding;
    },
    dispose() {
      for (const timer of timers) clearTo(timer);
      timers.clear();
      ducker.reset();
      if (ctx?.close) void ctx.close().catch(() => undefined);
      ctx = null;
      buffers.clear();
      decoding.clear();
      pools.clear();
    },
  };
}
