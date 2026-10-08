// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Choco } from './index.tsx';
import type { ChocoHandle } from './index.tsx';
import type { ChocoAsset, ChocoMountOptions, ChocoPlayer } from '@chocopie/runtime';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@chocopie/runtime', () => ({ loadChoco: load }));

const palette = { ink: '#000000', secondary: '#ffffff', accent: '#ff0000', background: '#ffffff' };
function asset() {
  const canvas = document.createElement('canvas');
  const player: ChocoPlayer = { canvas, currentTime: 0, presentedFrames: 1, isSchedulingFrames: false,
    state: 'idle', isSettled: true, whenSettled: vi.fn(async () => {}), point: vi.fn(() => null), bounds: vi.fn(() => null), hitTest: vi.fn(() => null),
    setState: vi.fn(), trigger: vi.fn(), setPaused: vi.fn(), setPlaybackEnabled: vi.fn(),
    setReducedMotion: vi.fn(), setPalette: vi.fn(), look: vi.fn(), seekSeconds: vi.fn(), advance: vi.fn(),
    destroy: vi.fn(() => canvas.remove()) };
  const value = { manifest: { palette, states: ['idle', 'success'] }, viewBox: [0, 0, 200, 100],
    dispose: vi.fn(), mount: vi.fn((host: HTMLElement, _options?: ChocoMountOptions) => { host.append(canvas); return player; }) };
  return { value: value as unknown as ChocoAsset, player, mount: value.mount, dispose: value.dispose };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  load.mockReset();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); });

describe('React player ownership', () => {
  it('renders on the server without loading a WASM engine', () => {
    const html = renderToString(<Choco src="/moment.choco" label="Success" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading artwork');
    expect(load).not.toHaveBeenCalled();
  });

  it('aborts an obsolete source, disposes late assets, and destroys the current player on unmount', async () => {
    const first = pending<ChocoAsset>(); const second = pending<ChocoAsset>();
    const old = asset(); const current = asset(); const ready = vi.fn();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(() => root.render(<Choco src="/first.choco" onReady={ready} />));
    const signal = load.mock.calls[0][1].signal as AbortSignal;
    await act(() => root.render(<Choco src="/second.choco" onReady={ready} />));
    expect(signal.aborted).toBe(true);
    await act(() => first.resolve(old.value));
    expect(old.mount).not.toHaveBeenCalled(); expect(old.dispose).toHaveBeenCalledOnce();
    await act(() => second.resolve(current.value));
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(ready).toHaveBeenCalledOnce();
    await act(() => root.unmount());
    expect(current.player.destroy).toHaveBeenCalledOnce(); expect(current.dispose).toHaveBeenCalledOnce();
  });

  it('uses the newest controls while loading and updates without recreating the player', async () => {
    const deferred = pending<ChocoAsset>(); const current = asset();
    load.mockReturnValue(deferred.promise);
    const ref = createRef<ChocoHandle>();
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" state="idle" />));
    expect(ref.current?.player).toBeNull();
    expect(() => ref.current?.setState('success')).toThrow('not ready');
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" state="success" paused reducedMotion />));
    await act(() => deferred.resolve(current.value));
    expect(current.mount.mock.calls[0][1]).toMatchObject({ state: 'success', paused: true, reducedMotion: true });
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" state="idle" />));
    expect(load).toHaveBeenCalledOnce(); expect(current.mount).toHaveBeenCalledOnce();
    expect(current.player.setState).toHaveBeenLastCalledWith('idle');
    expect(current.player.setPaused).toHaveBeenLastCalledWith(false);
    expect(current.player.setReducedMotion).toHaveBeenLastCalledWith(undefined);
    ref.current!.seekSeconds(0.25);
    expect(current.player.seekSeconds).toHaveBeenLastCalledWith(0.25);
  });

  it('reports failures accessibly and recovers after a source change', async () => {
    const failed = pending<ChocoAsset>(); const current = asset(); const onError = vi.fn();
    load.mockReturnValueOnce(failed.promise).mockResolvedValueOnce(current.value);
    await act(() => root.render(<Choco src="/missing.choco" label="Result" onError={onError} />));
    await act(() => failed.reject(new Error('Not found')));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Artwork could not be loaded.');
    expect(onError.mock.calls[0][0].message).toBe('Not found');
    await act(() => root.render(<Choco src="/valid.choco" label="Result" onError={onError} />));
    expect(container.querySelector('[data-choco-status="ready"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('gives labelled interactive artwork a keyboard equivalent for click triggers', async () => {
    const current = asset(); load.mockResolvedValue(current.value);
    await act(() => root.render(<Choco src="/moment.choco" interactive label="Celebrate" />));
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute('tabindex')).toBe('0');
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
    expect(current.player.trigger).toHaveBeenCalledTimes(2);
    expect(current.player.trigger).toHaveBeenCalledWith('click');
    expect(() => renderToString(<Choco src="/moment.choco" interactive />)).toThrow('accessible label');
  });

  it('sizes its canvas host and exposes rendering errors even for decorative artwork', async () => {
    const current = asset(); const ref = createRef<ChocoHandle>();
    load.mockResolvedValue(current.value);
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" style={{ height: 240 }} />));
    const wrapper = container.querySelector<HTMLElement>('[data-choco-status]')!;
    expect(wrapper.style.height).toBe('240px');
    expect(wrapper.style.aspectRatio).toBe('2');
    expect(current.player.canvas.parentElement!.style.height).toBe('100%');
    await act(() => current.mount.mock.calls[0][1]!.onError!(new Error('Renderer failed')));
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.closest('[aria-hidden="true"]')).toBeNull();
    expect(ref.current!.player).toBeNull();
    expect(() => ref.current!.trigger('click')).toThrow('not ready');
    expect(current.player.destroy).toHaveBeenCalledOnce();
    expect(current.dispose).toHaveBeenCalledOnce();
  });

  it('preserves imperative state when a different controlled field changes', async () => {
    const current = asset(); const ref = createRef<ChocoHandle>(); load.mockResolvedValue(current.value);
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" />));
    ref.current!.setState('success');
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" paused />));
    expect(current.player.setState).toHaveBeenCalledOnce();
    expect(current.player.setState).toHaveBeenCalledWith('success', undefined);
    expect(current.player.setPaused).toHaveBeenLastCalledWith(true);
  });

  it('releases the player when a controlled update fails', async () => {
    const current = asset(); const ref = createRef<ChocoHandle>(); const onError = vi.fn();
    load.mockResolvedValue(current.value);
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" onError={onError} />));
    vi.mocked(current.player.setState).mockImplementation(() => { throw new Error('Unknown state'); });
    await act(() => root.render(<Choco ref={ref} src="/moment.choco" state="missing" onError={onError} />));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(ref.current!.player).toBeNull();
    expect(current.player.destroy).toHaveBeenCalledOnce();
    expect(current.dispose).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});
