// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas } from '../packages/runtime/src/canvas.ts';
import type { NativeAsset } from '../packages/runtime/src/core.ts';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({width, height, data: new Uint8ClampedArray(width * height * 4)}),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.IntersectionObserver = class {
    root = null; rootMargin = ''; scrollMargin = ''; thresholds = [0];
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
  };
  window.matchMedia = () => Object.assign(new EventTarget(), {
    matches: false, media: '', onchange: null, addListener() {}, removeListener() {},
  });
});

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

/** The clock-completion rules are tested in Rust; this owner isolates presenter waiter cleanup. */
function mounted(settled = false) {
  const native = {
    isSettled: settled, changed: true, needsFrame: false, time: 0,
    frame: (_delta: number, width: number, height: number) => new Uint8Array(width * height * 4),
    pause() {}, seek() { native.isSettled = true; },
    dispose: vi.fn(),
    hitTest: vi.fn<(x: number, y: number) => {id: string; name: string} | null>(() => null),
  };
  const asset = {
    metadata: {manifest: {name: 'Waiter test'}, viewBox: [0,0,16,16]},
    player: () => native,
  } as unknown as NativeAsset;
  const host = document.createElement('div');
  document.body.append(host);
  const rect = {left: 10, top: 20, width: 16, height: 16, right: 26, bottom: 36};
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  const player = mountCanvas(asset, host, {manual: true});
  vi.spyOn(player.canvas, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  return {player, native, host};
}

describe('presenter finite-motion waiters', () => {
  it('resolves immediately for settled motion without scheduling a frame', async () => {
    const {player, native} = mounted(true);
    await player.whenSettled();
    expect(player.isSchedulingFrames).toBe(false);
    player.destroy();
    expect(native.dispose).toHaveBeenCalledOnce();
  });

  it('keeps waits pending during suspension and completes them after a control settles motion', async () => {
    const {player} = mounted();
    let completed = false;
    const pending = player.whenSettled().then(() => { completed = true; });
    player.setPlaybackEnabled(false);
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(player.isSchedulingFrames).toBe(false);
    player.seekSeconds(2);
    await pending;
    expect(completed).toBe(true);
    player.destroy();
  });

  it('removes canceled waiters without canceling other callers', async () => {
    const {player, native} = mounted();
    const signal = new AbortController();
    const remove = vi.spyOn(signal.signal, 'removeEventListener');
    const canceled = player.whenSettled(signal.signal);
    const live = player.whenSettled();
    const rejected = expect(canceled).rejects.toMatchObject({name: 'AbortError'});
    signal.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    native.isSettled = true;
    player.advance(0);
    await live;
    player.destroy();
  });

  it('rejects outstanding waits on destruction and releases abort listeners', async () => {
    const {player, native, host} = mounted();
    const signal = new AbortController();
    const remove = vi.spyOn(signal.signal, 'removeEventListener');
    const waiting = player.whenSettled(signal.signal);
    const rejected = expect(waiting).rejects.toMatchObject({name: 'AbortError'});
    player.destroy();
    player.destroy();
    await rejected;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(native.dispose).toHaveBeenCalledOnce();
    expect(host.children).toHaveLength(0);
  });
});


it('maps client picking into native canvas pixels and preserves geometry misses', () => {
  const {player, native} = mounted(true);
  native.hitTest.mockReturnValueOnce({id: 'inner', name: 'Inner'});
  expect(player.hitTest(18,28)).toEqual({id: 'inner', name: 'Inner'});
  expect(native.hitTest).toHaveBeenCalledWith(8,8);
  expect(player.hitTest(18,28)).toBeNull();
  native.hitTest.mockClear();
  expect(player.hitTest(5,28)).toBeNull();
  expect(native.hitTest).not.toHaveBeenCalled();
  player.destroy();
});
