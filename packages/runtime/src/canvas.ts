import { copyPixels } from './pixels.ts';
import type { ChocoPalette, ChocoTrigger, NativeAsset, NativePlayer } from './core.ts';

export type ChocoMountOptions = {
  paused?: boolean;
  state?: string;
  palette?: ChocoPalette;
  /** Respect the system preference by default. Set explicitly for recording. */
  reducedMotion?: boolean;
  /** Pointer reactions are opt-in. The host retains ownership of application actions. */
  interactive?: boolean;
  pointerTarget?: Element;
  /** Manual playback: no animation frame scheduling or visibility suspension. */
  manual?: boolean;
  onError?: (error: Error) => void;
};
export interface ChocoPlayer {
  readonly canvas: HTMLCanvasElement;
  readonly currentTime: number;
  readonly state: string;
  readonly isSettled: boolean;
  /** Wait for current finite motion; ambient loops do not delay completion. Suspended playback keeps the wait pending. Destroy/cancel reject with AbortError. */
  whenSettled(signal?: AbortSignal): Promise<void>;
  /** Client-coordinate rectangles of visible named parts. Selection is based on rig boxes, not path coverage or clips. */
  bounds(id: string): {left: number; top: number; width: number; height: number} | null;
  /** Project an authored viewBox point through the named part's animated transform. */
  point(id: string, point: readonly [number, number]): readonly [number, number] | null;
  /** Last presented one-pixel painted coverage; alpha-mask blending precision is limited. */
  hitTest(clientX: number, clientY: number): {id: string; name: string} | null;
  readonly presentedFrames: number;
  readonly isSchedulingFrames: boolean;
  setState(name: string, restart?: boolean): void;
  trigger(name: ChocoTrigger): void;
  setPaused(paused: boolean): void;
  setPlaybackEnabled(enabled: boolean): void;
  setReducedMotion(reduced: boolean | undefined): void;
  setPalette(palette: ChocoPalette): void;
  look(point: readonly [number, number] | null): void;
  seekSeconds(seconds: number): void;
  /** Deterministic elapsed active time, for capture and conformance. */
  advance(seconds: number): void;
  destroy(): void;
}

export function mountCanvas(asset: NativeAsset, container: HTMLElement, options: ChocoMountOptions = {}): ChocoPlayer {
  const doc = container.ownerDocument, win = doc.defaultView;
  if (!win) throw new Error('Mount .choco in a browser document.');
  const canvas = doc.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', asset.metadata.manifest.name);
  // CPU-rendered pixels use the software backing path. Accelerated WebKit canvas
  // painting can suppress resize notifications once playback stops scheduling.
  const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
  if (!context) throw new Error('Canvas rendering is unavailable.');
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedOverride = options.reducedMotion;
  let width = 1, height = 1, image: ImageData | undefined;
  let paused = options.paused ?? false, enabled = true, intersecting = false;
  let disposed = false, frame = 0, lastTime: number | undefined, presented = 0;
  let native: NativePlayer | undefined;
  const subscriptions = new win.AbortController();
  const waiters = new Set<{ resolve(): void; reject(error: unknown): void }>();
  function notifySettled() {
    if (native?.isSettled) for (const waiter of waiters) waiter.resolve();
  }
  function whenSettled(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      if (live().isSettled) { resolve(); return; }
      function cleanup() { waiters.delete(waiter); signal?.removeEventListener('abort', abort); }
      const waiter = {
        resolve() { cleanup(); resolve(); },
        reject(error: unknown) { cleanup(); reject(error); },
      };
      const abort = () => waiter.reject(signal?.reason);
      waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  const resize = new win.ResizeObserver(() => safely(() => draw(0)));
  const intersection = new win.IntersectionObserver(entries => {
    intersecting = entries.at(-1)?.isIntersecting ?? false;
    schedule();
  });
  function live() {
    if (disposed || !native) throw new Error('This .choco player has been disposed.');
    return native;
  }
  function stop() {
    if (frame) win!.cancelAnimationFrame(frame);
    frame = 0; lastTime = undefined;
  }
  function canSchedule() {
    return !disposed && !options.manual && !paused && enabled && intersecting && !doc.hidden && canvas.isConnected && native?.needsFrame;
  }
  function schedule() {
    if (!canSchedule()) { stop(); return; }
    if (!frame) frame = win!.requestAnimationFrame(tick);
  }
  function dimensions() {
    const rect = container.getBoundingClientRect();
    const dpr = win!.devicePixelRatio;
    const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const w = Math.max(1, rect.width * scale), h = Math.max(1, rect.height * scale);
    if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error('Invalid canvas dimensions.');
    const fit = Math.min(1, 4096 / Math.max(w, h), Math.sqrt(4_194_304 / (w * h)));
    width = Math.max(1, Math.floor(w * fit)); height = Math.max(1, Math.floor(h * fit));
  }
  function draw(delta: number) {
    const player = live();
    dimensions();
    const pixels = player.frame(delta, width, height);
    if (player.changed) {
      if (!image || image.width !== width || image.height !== height) {
        canvas.width = width; canvas.height = height;
        image = context!.createImageData(width, height);
      }
      copyPixels(pixels, image.data);
      context!.putImageData(image, 0, 0);
      presented++;
    }
    notifySettled();
    schedule();
  }
  function safely(operation: () => void) {
    if (disposed) return;
    try { operation(); }
    catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      destroy();
      if (options.onError) options.onError(error);
      else queueMicrotask(() => { throw error; });
    }
  }
  function tick(time: number) {
    frame = 0;
    if (!canSchedule()) { stop(); return; }
    const delta = lastTime === undefined ? 0 : Math.max(0, (time - lastTime) / 1000);
    lastTime = time;
    safely(() => draw(delta));
  }
  function update(operation: (player: NativePlayer) => void) {
    operation(live());
    draw(0);
  }
  function clientBounds(bounds: readonly [number, number, number, number]) {
    const rect = canvas.getBoundingClientRect();
    const [x, y, w, h] = asset.metadata.viewBox;
    const scale = Math.min(width / w, height / h);
    return {
      left: rect.left + ((width - w * scale) / 2 + (bounds[0] - x) * scale) * rect.width / width,
      top: rect.top + ((height - h * scale) / 2 + (bounds[1] - y) * scale) * rect.height / height,
      width: bounds[2] * scale * rect.width / width,
      height: bounds[3] * scale * rect.height / height,
    };
  }
  function destroy() {
    if (disposed) return;
    disposed = true; stop();
    for (const waiter of waiters) waiter.reject(new win!.DOMException('The .choco player was destroyed.', 'AbortError'));
    subscriptions.abort(); resize.disconnect(); intersection.disconnect();
    native?.dispose(); native = undefined;
    canvas.remove();
    // Release the backing store even if the caller keeps the returned player object.
    canvas.width = 1; canvas.height = 1; image = undefined;
  }
  try {
    dimensions();
    native = asset.player(width, height, reducedOverride ?? media.matches);
    native.pause(paused);
    if (options.state !== undefined) native.state(options.state);
    if (options.palette !== undefined) native.palette(options.palette);
    container.append(canvas);
    draw(0);
    resize.observe(container);
    intersection.observe(canvas);
    const eventOptions = { signal: subscriptions.signal };
    doc.addEventListener('visibilitychange', schedule, eventOptions);
    win.addEventListener('resize', () => safely(() => draw(0)), eventOptions);
    media.addEventListener('change', () => safely(() => update(player => player.reduced(reducedOverride ?? media.matches))), eventOptions);
    if (options.interactive) {
      const target = options.pointerTarget ?? canvas;
      target.addEventListener('pointerenter', () => safely(() => update(player => player.trigger('hover'))), eventOptions);
      target.addEventListener('pointermove', event => safely(() => {
        const pointer = event as PointerEvent;
        const rect = canvas.getBoundingClientRect(), [x, y, w, h] = asset.metadata.viewBox;
        const scale = Math.min(rect.width / w, rect.height / h);
        if (scale <= 0) return;
        update(player => player.look([x + (pointer.clientX - rect.left - (rect.width - w * scale) / 2) / scale,
          y + (pointer.clientY - rect.top - (rect.height - h * scale) / 2) / scale]));
      }), eventOptions);
      target.addEventListener('pointerleave', () => safely(() => update(player => player.look(null))), eventOptions);
      // External buttons/cards keep their own click and keyboard behavior.
      if (!options.pointerTarget) {
        canvas.addEventListener('click', () => safely(() => update(player => player.trigger('click'))), eventOptions);
      }
    }
  } catch (cause) { destroy(); throw cause; }
  return {
    canvas,
    whenSettled,
    get state() { return live().info().state; },
    get isSettled() { return live().isSettled; },
    bounds(id) { const part = live().info().parts.find(part => part.id === id); return part ? clientBounds(part.bounds) : null; },
    point(id, point) {
      if (!point.every(Number.isFinite)) return null;
      const part = live().info().parts.find(part => part.id === id);
      if (!part) return null;
      const [a,b,c,d,e,f] = part.transform;
      const box = clientBounds([a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f, 0, 0]);
      return [box.left, box.top];
    },
    hitTest(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const rect = canvas.getBoundingClientRect();
      if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return null;
      if (rect.width <= 0 || rect.height <= 0) return null;
      return live().hitTest((x - rect.left) * width / rect.width, (y - rect.top) * height / rect.height);
    },
    get currentTime() { return native?.time ?? 0; },
    get presentedFrames() { return presented; },
    get isSchedulingFrames() { return frame !== 0; },
    setState: (name, restart) => update(player => player.state(name, restart)),
    trigger: name => update(player => player.trigger(name)),
    setPalette: palette => update(player => player.palette(palette)),
    look: point => update(player => player.look(point)),
    setPaused(value) { live().pause(value); paused = value; lastTime = undefined; draw(0); },
    setPlaybackEnabled(value) { live(); enabled = value; schedule(); },
    setReducedMotion(value) { update(player => player.reduced(value ?? media.matches)); reducedOverride = value; },
    seekSeconds(seconds) { update(player => player.seek(seconds)); lastTime = undefined; },
    advance(seconds) { draw(seconds); },
    destroy,
  };
}
