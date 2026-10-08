'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { loadChoco } from '@chocopie-moments/runtime';
import type { ChocoAsset, ChocoPalette, ChocoPlayer, ChocoTrigger } from '@chocopie-moments/runtime';

export type ChocoProps = {
  readonly src: Parameters<typeof loadChoco>[0];
  readonly state?: string;
  readonly paused?: boolean;
  readonly palette?: ChocoPalette;
  /** Omit to follow the browser's prefers-reduced-motion setting. */
  readonly reducedMotion?: boolean;
  readonly interactive?: boolean;
  /** Omit for decorative artwork. Interactive artwork requires a label. */
  readonly label?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly loadingFallback?: ReactNode;
  readonly errorFallback?: ReactNode | ((error: Error) => ReactNode);
  readonly onReady?: (player: ChocoPlayer, asset: ChocoAsset) => void;
  readonly onError?: (error: Error) => void;
};

/** Commands require a ready player. Use onReady or inspect player before calling. */
export type ChocoHandle = {
  readonly player: ChocoPlayer | null;
  setState: (name: string, restart?: boolean) => void;
  setPaused: (paused: boolean) => void;
  trigger: (event: ChocoTrigger) => void;
  look: (point: readonly [number, number] | null) => void;
  seekSeconds: (seconds: number) => void;
};

type Mounted = { player: ChocoPlayer; asset: ChocoAsset;
  controls: { state?: string; palette?: ChocoPalette; reducedMotion?: boolean; paused: boolean } };
type Loaded = { src: ChocoProps['src']; interactive: boolean; aspectRatio?: number } & (
  | { status: 'ready' }
  | { status: 'error'; error: Error }
);
const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));

/** A thin canvas host over the shared WASM player; loading starts only after mounting. */
export const Choco = forwardRef<ChocoHandle, ChocoProps>(function Choco(props, ref) {
  const { src, state, paused = false, palette, reducedMotion, interactive = false,
    label, className, style, loadingFallback, errorFallback } = props;
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const playbackError = useRef<(error: unknown) => void>(() => {});
  const latest = useRef(props);
  latest.current = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useImperativeHandle(ref, () => {
    const player = () => {
      if (mounted.current === null) throw new Error('Choco is not ready. Wait for onReady before sending commands.');
      return mounted.current.player;
    };
    return {
      get player() { return mounted.current?.player ?? null; },
      setState: (name, restart) => player().setState(name, restart),
      setPaused: value => player().setPaused(value),
      trigger: event => player().trigger(event),
      look: point => player().look(point),
      seekSeconds: seconds => player().seekSeconds(seconds),
    };
  }, []);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    const abort = new AbortController();
    let owned: Mounted | null = null;
    const fail = (error: unknown) => {
      if (abort.signal.aborted) return;
      const value = asError(error);
      owned?.player.destroy();
      owned?.asset.dispose();
      if (mounted.current === owned) mounted.current = null;
      owned = null;
      setLoaded({ src, interactive, status: 'error', error: value });
      latest.current.onError?.(value);
    };
    playbackError.current = fail;
    void loadChoco(src, { signal: abort.signal }).then(asset => {
      if (abort.signal.aborted) { asset.dispose(); return; }
      try {
        const current = latest.current;
        const player = asset.mount(container, { interactive, state: current.state,
          paused: current.paused ?? false, palette: current.palette,
          reducedMotion: current.reducedMotion, onError: fail });
        owned = { player, asset, controls: { state: current.state, paused: current.paused ?? false,
          palette: current.palette, reducedMotion: current.reducedMotion } };
        mounted.current = owned;
        setLoaded({ src, interactive, status: 'ready', aspectRatio: asset.viewBox[2] / asset.viewBox[3] });
        current.onReady?.(player, asset);
      } catch (error) {
        owned?.player.destroy();
        asset.dispose();
        owned = null;
        mounted.current = null;
        fail(error);
      }
    }, fail);
    return () => {
      abort.abort();
      owned?.player.destroy();
      owned?.asset.dispose();
      if (mounted.current === owned) mounted.current = null;
    };
  }, [src, interactive]);

  useEffect(() => {
    const current = mounted.current;
    if (current === null) return;
    try {
      // Prop changes control only the changed field, preserving imperative commands
      // when an unrelated prop (such as paused) changes.
      if (state !== current.controls.state) {
        current.player.setState(state ?? 'idle'); current.controls.state = state;
      }
      if (paused !== current.controls.paused) {
        current.player.setPaused(paused); current.controls.paused = paused;
      }
      if (palette !== current.controls.palette) {
        current.player.setPalette(palette ?? current.asset.manifest.palette); current.controls.palette = palette;
      }
      if (reducedMotion !== current.controls.reducedMotion) {
        current.player.setReducedMotion(reducedMotion); current.controls.reducedMotion = reducedMotion;
      }
      setLoaded({ src, interactive, status: 'ready', aspectRatio: current.asset.viewBox[2] / current.asset.viewBox[3] });
    } catch (error) {
      playbackError.current(error);
    }
  }, [src, interactive, state, paused, palette, reducedMotion]);

  if (interactive && !label?.trim()) throw new Error('Interactive Choco artwork needs an accessible label.');
  const current = loaded !== null && loaded.src === src && loaded.interactive === interactive ? loaded : null;
  const status = current?.status ?? 'loading';
  const error = current?.status === 'error' ? current.error : null;
  return <div className={className} style={{ position: 'relative', width: '100%', aspectRatio: current?.aspectRatio ?? 1, ...style }} data-choco-status={status}
    aria-busy={status === 'loading'}
    role={interactive ? 'group' : undefined} aria-label={interactive ? label : undefined}
    tabIndex={interactive && status === 'ready' ? 0 : undefined}
    onKeyDown={interactive ? event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && mounted.current !== null) {
        event.preventDefault();
        try { mounted.current.player.trigger('click'); }
        catch (error) { playbackError.current(error); }
      }
    } : undefined}>
    <div ref={host} style={{ width: '100%', height: '100%' }} aria-hidden={label === undefined || interactive ? true : undefined}
      role={label !== undefined && !interactive ? 'img' : undefined} aria-label={!interactive ? label : undefined} />
    {status === 'loading' && <div role="status" style={{ position: 'absolute', inset: 0 }}>{loadingFallback ?? 'Loading artwork…'}</div>}
    {error !== null && <div role="alert" style={{ position: 'absolute', inset: 0 }}>{typeof errorFallback === 'function'
      ? errorFallback(error) : errorFallback ?? 'Artwork could not be loaded.'}</div>}
  </div>;
});
