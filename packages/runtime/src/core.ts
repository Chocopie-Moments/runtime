import type { Engine } from './choco.mjs';
import type { ChocoManifest } from '../../codec/src/index.ts';

export type ChocoPalette = ChocoManifest['palette'];
export type ChocoTrigger = 'enter' | 'hover' | 'click';
export type Metadata = {
  readonly manifest: ChocoManifest;
  readonly viewBox: readonly [number, number, number, number];
  readonly attribution: string | null;
};
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let engine: Promise<Engine> | undefined;
function sharedEngine() {
  // No DOM or WASM startup at import time: safe in SSR and server component module graphs.
  return engine ??= import('./choco.mjs').then(({ default: initialize }) => initialize({
    // Emscripten accepts file URLs in Node and fetchable URLs in browsers/workers.
    locateFile: () => new URL('./choco.wasm', import.meta.url).href,
  })).catch(error => {
    engine = undefined;
    throw error;
  });
}
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function allocate(core: Engine, size: number) {
  const address = core._malloc(size);
  if (!address) throw new Error('Not enough memory for the .choco player.');
  return address;
}
function failure(core: Engine, address: number) {
  const bytes = core.HEAPU8.subarray(address, address + 512);
  return new Error(decoder.decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0))));
}

/** Decoded once by the shared native boundary; no duplicate JavaScript scene decoder. */
export class NativeAsset {
  private constructor(private readonly core: Engine, private handle: number, readonly metadata: Metadata) {}
  static async load(bytes: Uint8Array, signal?: AbortSignal) {
    if (bytes.length > 1_048_576) throw new Error('The .choco file exceeds the byte limit.');
    signal?.throwIfAborted();
    const core = await withAbort(sharedEngine(), signal);
    signal?.throwIfAborted();
    const error = allocate(core, 512);
    let input = 0, metadata = 0, handle = 0;
    try {
      input = allocate(core, bytes.length || 1);
      core.HEAPU8.set(bytes, input);
      handle = core._choco_asset_create(input, bytes.length, error, 512);
      if (!handle) throw failure(core, error);
      const count = core._choco_asset_metadata(handle, 0, 0);
      if (!count) throw new Error('Could not read the .choco asset metadata.');
      metadata = allocate(core, count);
      core._choco_asset_metadata(handle, metadata, count);
      // The native decoder validated this metadata against the full archive and program.
      const data: Metadata = JSON.parse(decoder.decode(core.HEAPU8.subarray(metadata, metadata + count)));
      signal?.throwIfAborted();
      return new NativeAsset(core, handle, data);
    } catch (cause) {
      if (handle) core._choco_asset_destroy(handle);
      throw cause;
    } finally {
      core._free(metadata); core._free(input); core._free(error);
    }
  }
  player(width: number, height: number, reduced: boolean) {
    if (!this.handle) throw new Error('This .choco asset has been disposed.');
    return new NativePlayer(this.core, this.handle, width, height, reduced);
  }
  dispose() {
    if (this.handle) this.core._choco_asset_destroy(this.handle);
    this.handle = 0;
  }
}

export class NativePlayer {
  private handle = 0;
  private error = 0;
  private status = 0;
  time = 0;
  needsFrame = false;
  changed = false;
  constructor(private readonly core: Engine, asset: number, width: number, height: number, reduced: boolean) {
    validateDimensions(width, height);
    try {
      this.error = allocate(core, 512);
      this.status = allocate(core, 24);
      this.handle = core._choco_player_from_asset(asset, width, height, reduced, this.error, 512);
      if (!this.handle) throw failure(core, this.error);
    } catch (cause) { this.dispose(); throw cause; }
  }
  private live() {
    if (!this.handle) throw new Error('This .choco player has been disposed.');
    return this.handle;
  }
  private check(success: boolean) { if (!success) throw failure(this.core, this.error); }
  get isSettled() { return !!this.core._choco_player_settled(this.live()); }
  info(): {state: string; parts: {id: string; name: string; bounds: [number, number, number, number]; transform: [number, number, number, number, number, number]}[]} {
    const handle = this.live();
    const count = this.core._choco_player_info(handle, 0, 0, this.error, 512);
    if (!count) throw failure(this.core, this.error);
    const pointer = allocate(this.core, count);
    try {
      if (!this.core._choco_player_info(handle, pointer, count, this.error, 512)) throw failure(this.core, this.error);
      return JSON.parse(decoder.decode(this.core.HEAPU8.subarray(pointer, pointer + count)));
    } finally { this.core._free(pointer); }
  }
  hitTest(x: number, y: number): {id: string; name: string} | null {
    const handle = this.live();
    const count = this.core._choco_player_hit_test(handle, x, y, 0, 0, this.error, 512);
    if (!count) throw failure(this.core, this.error);
    const pointer = allocate(this.core, count);
    try {
      if (!this.core._choco_player_hit_test(handle, x, y, pointer, count, this.error, 512)) throw failure(this.core, this.error);
      return JSON.parse(decoder.decode(this.core.HEAPU8.subarray(pointer, pointer + count)));
    } finally { this.core._free(pointer); }
  }
  frame(delta: number, width: number, height: number) {
    validateDimensions(width, height);
    const pointer = this.core._choco_web_frame(this.live(), delta, width, height, this.status, this.error, 512);
    if (!pointer) throw failure(this.core, this.error);
    const status = new Float64Array(this.core.HEAPU8.buffer, this.status, 3);
    this.changed = status[0] !== 0; this.needsFrame = status[1] !== 0; this.time = status[2];
    return this.core.HEAPU8.subarray(pointer, pointer + width * height * 4);
  }
  state(name: string, restart = false) {
    if (typeof name !== 'string' || name.length > 256) throw new Error('Invalid .choco state name.');
    const handle = this.live(), bytes = encoder.encode(name === 'idle' ? '' : name);
    const pointer = allocate(this.core, bytes.length || 1);
    try {
      this.core.HEAPU8.set(bytes, pointer);
      this.check(this.core._choco_player_state(handle, pointer, bytes.length, restart, this.error, 512));
    } finally { this.core._free(pointer); }
  }
  trigger(name: ChocoTrigger) {
    const id = ['enter', 'hover', 'click'].indexOf(name);
    this.check(this.core._choco_player_trigger(this.live(), id, this.error, 512));
  }
  seek(seconds: number) { this.check(this.core._choco_player_seek(this.live(), seconds, this.error, 512)); }
  pause(paused: boolean) { this.check(this.core._choco_player_pause(this.live(), paused, this.error, 512)); }
  reduced(reduced: boolean) { this.check(this.core._choco_player_reduced_motion(this.live(), reduced, this.error, 512)); }
  look(point: readonly [number, number] | null) {
    this.check(this.core._choco_player_look(this.live(), point !== null, point?.[0] ?? 0, point?.[1] ?? 0, this.error, 512));
  }
  palette(palette: ChocoPalette) {
    const colors = [palette.accent, palette.secondary, palette.ink, palette.background].map(color => {
      if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Palette colors must be six-digit hex values.');
      return Number.parseInt(color.slice(1), 16);
    });
    this.check(this.core._choco_player_palette(this.live(), colors[0], colors[1], colors[2], colors[3], this.error, 512));
  }
  dispose() {
    if (this.handle) this.core._choco_player_destroy(this.handle);
    this.core._free(this.error); this.core._free(this.status);
    this.handle = 0; this.error = 0; this.status = 0;
  }
}

export function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304) {
    throw new Error('Render dimensions exceed the pixel budget.');
  }
}
