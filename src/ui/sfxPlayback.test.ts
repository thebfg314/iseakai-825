import { describe, expect, it } from "vitest";
import { createMusicDucker, createSfxPlayer, type AudioLike } from "./sfxPlayback";

function fakeMusic(paused = false) {
  const calls: string[] = [];
  const handle = {
    paused,
    pause() {
      this.paused = true;
      calls.push("pause");
    },
    play() {
      this.paused = false;
      calls.push("play");
    },
  };
  return { handle, calls };
}

class FakeAudio implements AudioLike {
  static constructed = 0;
  src: string;
  volume = 1;
  currentTime = 0;
  paused = true;
  ended = false;
  preload = "";
  listeners = new Map<string, Array<() => void>>();

  constructor(src?: string) {
    FakeAudio.constructed += 1;
    this.src = src ?? "";
  }

  play() {
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {
    /* preload */
  }

  addEventListener(type: string, listener: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: () => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((fn) => fn !== listener),
    );
  }

  finish() {
    this.paused = true;
    this.ended = true;
    for (const fn of this.listeners.get("ended") ?? []) fn();
  }
}

describe("music ducker", () => {
  it("pauses playing music for overlay duration and resumes from the same handle", () => {
    const { handle, calls } = fakeMusic(false);
    const ducker = createMusicDucker(() => handle);
    const release = ducker.begin();
    expect(handle.paused).toBe(true);
    expect(ducker.holding).toBe(true);
    release();
    expect(handle.paused).toBe(false);
    expect(calls).toEqual(["pause", "play"]);
    expect(ducker.holding).toBe(false);
  });

  it("does not auto-unpause if the bed was already paused", () => {
    const { handle, calls } = fakeMusic(true);
    const ducker = createMusicDucker(() => handle);
    const release = ducker.begin();
    expect(calls).toEqual([]);
    release();
    expect(handle.paused).toBe(true);
    expect(calls).toEqual([]);
  });

  it("keeps music paused until the last overlapping overlay ends", () => {
    const { handle, calls } = fakeMusic(false);
    const ducker = createMusicDucker(() => handle);
    const fanfare = ducker.begin();
    const horn = ducker.begin();
    expect(calls).toEqual(["pause"]);
    fanfare();
    expect(handle.paused).toBe(true);
    expect(calls).toEqual(["pause"]);
    horn();
    expect(handle.paused).toBe(false);
    expect(calls).toEqual(["pause", "play"]);
  });
});

describe("sfx player", () => {
  it("reuses a preloaded HTML pool and resets currentTime instead of new Audio per click", () => {
    FakeAudio.constructed = 0;
    const player = createSfxPlayer({ getMusic: () => null, Audio: FakeAudio });
    player.preload(["click"]);
    const afterPreload = FakeAudio.constructed;
    expect(afterPreload).toBeGreaterThan(0);
    player.play("click", 0.6);
    player.play("click", 0.6);
    player.play("click", 0.6);
    expect(FakeAudio.constructed).toBe(afterPreload);
    player.dispose();
  });

  it("pauses music for a ducking cue and resumes when that element ends", () => {
    const { handle, calls } = fakeMusic(false);
    const constructed: FakeAudio[] = [];
    class OverlayAudio extends FakeAudio {
      constructor(src?: string) {
        super(src);
        constructed.push(this);
      }
    }
    const player = createSfxPlayer({ getMusic: () => handle, Audio: OverlayAudio });
    player.play("fanfare", 0.6, { duckMusic: true });
    expect(calls).toEqual(["pause"]);
    expect(handle.paused).toBe(true);
    const overlay = constructed[constructed.length - 1];
    overlay.finish();
    expect(calls).toEqual(["pause", "play"]);
    expect(handle.paused).toBe(false);
    player.dispose();
  });

  it("leaves user-paused music paused after a ducking cue", () => {
    const { handle, calls } = fakeMusic(true);
    const constructed: FakeAudio[] = [];
    class OverlayAudio extends FakeAudio {
      constructor(src?: string) {
        super(src);
        constructed.push(this);
      }
    }
    const player = createSfxPlayer({ getMusic: () => handle, Audio: OverlayAudio });
    player.play("horn", 0.6, { duckMusic: true });
    constructed[constructed.length - 1].finish();
    expect(calls).toEqual([]);
    expect(handle.paused).toBe(true);
    player.dispose();
  });
});
