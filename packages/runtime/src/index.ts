import { NativeAsset } from './core.ts';
import { mountCanvas } from './canvas.ts';
import type { ChocoMountOptions } from './canvas.ts';
import { fetchChoco } from '../../../src/codec/load.ts';
import { createFrames } from './frames.ts';
import type { ChocoFrameOptions } from './frames.ts';
export type { ChocoFrame, ChocoFrames, ChocoFrameOptions } from './frames.ts';
export type ChocoSource = string | URL | Uint8Array;
export type { ChocoPlayer, ChocoMountOptions } from './canvas.ts';
export type { ChocoPalette, ChocoTrigger } from './core.ts';

export class ChocoAsset {
  /** @internal Use loadChoco. */
  constructor(private readonly native: NativeAsset) {}
  get viewBox() { return this.native.metadata.viewBox; }
  get manifest() { return this.native.metadata.manifest; }
  get attribution() { return this.native.metadata.attribution; }
  mount(container: HTMLElement, options?: ChocoMountOptions) { return mountCanvas(this.native, container, options); }
  frames(options: ChocoFrameOptions) { return createFrames(this.native, options); }
  /** Prevent further mounts and free decoded data. Existing players remain independently owned. */
  dispose() { this.native.dispose(); }
}

/** Import safely during SSR. Load once, mount independently, destroy players and dispose the asset. */
export async function loadChoco(source: ChocoSource, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  if (source instanceof Uint8Array && source.length > 1_048_576) throw new Error('The .choco file exceeds the byte limit.');
  const bytes = source instanceof Uint8Array ? Uint8Array.from(source) : await fetchChoco(source, options.signal);
  return new ChocoAsset(await NativeAsset.load(bytes, options.signal));
}
