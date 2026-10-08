import { validateDimensions } from './core.ts';
import type { ChocoPalette, ChocoTrigger, NativeAsset } from './core.ts';
import { copyPixels } from './pixels.ts';

export type ChocoFrameOptions = {
  width: number;
  height: number;
  state?: string;
  palette?: ChocoPalette;
  reducedMotion?: boolean;
  paused?: boolean;
};
/** Owned pixels stay valid after rendering another frame or destroying any player. Straight sRGB RGBA. */
export type ChocoFrame = {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly changed: boolean;
  readonly needsFrame: boolean;
  readonly pixels: Uint8ClampedArray;
};
export interface ChocoFrames {
  readonly currentTime: number;
  readonly state: string;
  readonly needsFrame: boolean;
  readonly isSettled: boolean;
  render(): ChocoFrame;
  advance(seconds: number): ChocoFrame;
  seekSeconds(seconds: number): ChocoFrame;
  resize(width: number, height: number): ChocoFrame;
  setState(name: string, restart?: boolean): void;
  trigger(name: ChocoTrigger): void;
  setPaused(paused: boolean): void;
  setReducedMotion(reduced: boolean): void;
  setPalette(palette: ChocoPalette): void;
  look(point: readonly [number, number] | null): void;
  destroy(): void;
}

/** Deterministic, DOM-free capture owner over the shared engine. Reduced motion defaults to false. */
export function createFrames(asset: NativeAsset, options: ChocoFrameOptions): ChocoFrames {
  let { width, height } = options;
  let pendingPresentation = true;
  const player = asset.player(width, height, options.reducedMotion ?? false);
  function render(delta = 0): ChocoFrame {
    const source = player.frame(delta, width, height);
    const pixels = new Uint8ClampedArray(source.length);
    copyPixels(source, pixels);
    const changed = player.changed || pendingPresentation;
    pendingPresentation = false;
    return {width, height, pixels, time: player.time, changed, needsFrame: player.needsFrame};
  }
  function update(operation: () => void) {
    operation();
    player.frame(0, width, height);
    pendingPresentation ||= player.changed;
  }
  try {
    player.pause(options.paused ?? false);
    if (options.state !== undefined) player.state(options.state);
    if (options.palette !== undefined) player.palette(options.palette);
    player.frame(0, width, height);
  } catch (error) { player.dispose(); throw error; }
  return {
    get currentTime() { return player.time; },
    get state() { return player.info().state; },
    get needsFrame() { return player.needsFrame; },
    get isSettled() { return player.isSettled; },
    render,
    advance: seconds => render(seconds),
    seekSeconds(seconds) { player.seek(seconds); return render(); },
    resize(w, h) {
      validateDimensions(w, h);
      player.frame(0, w, h);
      pendingPresentation ||= player.changed;
      width = w; height = h;
      return render();
    },
    setState(name, restart) { update(() => player.state(name, restart)); },
    trigger(name) { update(() => player.trigger(name)); },
    setPaused(paused) { update(() => player.pause(paused)); },
    setReducedMotion(reduced) { update(() => player.reduced(reduced)); },
    setPalette(palette) { player.palette(palette); },
    look(point) { update(() => player.look(point)); },
    destroy() { player.dispose(); },
  };
}
