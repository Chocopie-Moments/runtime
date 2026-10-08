import { loadChoco } from '../packages/runtime/dist/index.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function assert(value, message) { if (!value) throw new Error(message); }
async function until(predicate, message) {
  const deadline = performance.now() + 8000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(message);
    await wait(20);
  }
}

export async function checkBrowser() {
  const checks = [];
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:240px;height:240px';
  document.body.append(host);
  const failures = [];
  let asset, player, capture;
  try {
    const started = performance.now();
    asset = await loadChoco('/fixtures/ambient.sway.choco');
    player = asset.mount(host, {onError: error => failures.push(error.message)});
    const firstDrawMs = performance.now() - started;
    await until(() => player.currentTime > .1, 'Visible ambient playback did not advance');
    assert(player.presentedFrames > 1, 'Visible player did not present changing frames');
    checks.push('visible playback');

    player.setPaused(true);
    const pausedAt = player.currentTime, frames = player.presentedFrames;
    await wait(100);
    assert(player.currentTime === pausedAt && player.presentedFrames === frames && !player.isSchedulingFrames, 'Paused player kept working');
    for (const width of [180,210,160]) {
      host.style.width = `${width}px`;
      try {
        await until(() => player.canvas.width === Math.floor(width * devicePixelRatio), 'Paused resize did not update pixels');
      } catch (error) {
        const rect = host.getBoundingClientRect();
        throw new Error(`${error.message}: ${JSON.stringify({hostWidth: rect.width, hostHeight: rect.height,
          canvasWidth: player.canvas.width, canvasHeight: player.canvas.height, devicePixelRatio,
          connected: player.canvas.isConnected, scheduling: player.isSchedulingFrames, failures})}`);
      }
      assert(player.currentTime === pausedAt, 'Resize advanced paused time');
      const resizedFrames = player.presentedFrames;
      await wait(500);
      assert(player.presentedFrames === resizedFrames && !player.isSchedulingFrames, 'Paused resize kept redrawing');
    }
    checks.push('paused clock and resize');

    player.setPaused(false);
    await until(() => player.currentTime > pausedAt, 'Resume did not restart playback');
    host.style.left = '-10000px';
    await until(() => !player.isSchedulingFrames, 'Offscreen player kept scheduling');
    const offscreenAt = player.currentTime;
    await wait(2200);
    assert(player.currentTime === offscreenAt, 'Offscreen clock advanced');
    host.style.left = '0';
    await until(() => player.currentTime > offscreenAt, 'Returning onscreen did not resume');
    assert(player.currentTime - offscreenAt < 2, 'Resume caught up hidden elapsed time');
    checks.push('offscreen suspension and resume');

    player.setPlaybackEnabled(false);
    const disabledAt = player.currentTime;
    await wait(80);
    assert(!player.isSchedulingFrames && player.currentTime === disabledAt, 'Explicit suspension failed');
    player.setPlaybackEnabled(true);
    player.setReducedMotion(true);
    await wait(80);
    assert(!player.isSchedulingFrames, 'Reduced motion kept scheduling');
    checks.push('explicit suspension and reduced motion');

    const finiteAsset = await loadChoco('/fixtures/beat.hop.choco');
    const finite = finiteAsset.mount(host, { manual: true });
    try {
      finite.trigger('click');
      let completed = false;
      const completion = finite.whenSettled().then(() => { completed = true; });
      await wait(40);
      assert(!completed && !finite.isSchedulingFrames, 'Completion wait advanced a suspended player');
      finite.advance(10);
      await completion;
      assert(completed && finite.isSettled, 'Finite completion did not resolve');
      finite.trigger('click');
      const cancel = new AbortController();
      const cancelled = finite.whenSettled(cancel.signal).then(() => false, error => error.name === 'AbortError');
      cancel.abort();
      assert(await cancelled, 'Completion cancellation did not reject');
      const destroyed = finite.whenSettled().then(() => false, error => error.name === 'AbortError');
      finite.destroy();
      assert(await destroyed, 'Destroy did not reject a pending completion');
      checks.push('finite completion, suspended wait and cancellation');
    } finally { finite.destroy(); finiteAsset.dispose(); }

    const clippedAsset = await loadChoco('/fixtures/scene.clip.evenodd.choco');
    const clipped = clippedAsset.mount(host, { manual: true });
    try {
      const rect = clipped.canvas.getBoundingClientRect();
      const scale = Math.min(rect.width, rect.height) / 160;
      const hit = (x, y) => clipped.hitTest(rect.left + (rect.width - 160 * scale) / 2 + x * scale,
        rect.top + (rect.height - 160 * scale) / 2 + y * scale);
      assert(hit(30, 70)?.id === 'part', 'Visible clipped geometry was not selectable');
      assert(hit(80, 80) === null, 'An even-odd clip hole was selectable');
      assert(hit(140, 140) === null, 'Nested clip excluded geometry was selectable');
      checks.push('shared geometry selection and nested clip holes');
    } finally { clipped.destroy(); clippedAsset.dispose(); }

    player.setReducedMotion(false);
    player.setPaused(true);
    player.seekSeconds(.25);
    capture = asset.frames({width:player.canvas.width,height:player.canvas.height});
    const reference = capture.seekSeconds(.25);
    const expected = document.createElement('canvas');
    expected.width = reference.width; expected.height = reference.height;
    const context = expected.getContext('2d', {alpha:true,colorSpace:'srgb',willReadFrequently:true});
    const pixels = context.createImageData(reference.width, reference.height);
    pixels.data.set(reference.pixels); context.putImageData(pixels,0,0);
    const shown = player.canvas.getContext('2d').getImageData(0,0,reference.width,reference.height).data;
    const normalized = context.getImageData(0,0,reference.width,reference.height).data;
    assert(shown.every((value,i) => value === normalized[i]), 'Canvas presentation differs from deterministic shared frames');
    checks.push('canvas and capture pixel equality');

    const aborted = new AbortController(); aborted.abort();
    let rejected = false;
    try { await loadChoco('/fixtures/ambient.sway.choco',{signal:aborted.signal}); } catch { rejected = true; }
    assert(rejected, 'Aborted load succeeded');
    rejected = false;
    try { await loadChoco(new Uint8Array([1,2,3])); } catch { rejected = true; }
    assert(rejected && capture.render().pixels.some(value=>value), 'Invalid load damaged an existing player');
    checks.push('abort and invalid asset isolation');

    const before = host.querySelectorAll('canvas').length;
    for (let i=0;i<25;i++) {
      const mounted = asset.mount(host,{paused:true});
      mounted.destroy(); mounted.destroy();
    }
    assert(host.querySelectorAll('canvas').length === before, 'Mount/unmount retained DOM surfaces');
    asset.dispose();
    assert(capture.render().pixels.some(value=>value), 'Asset disposal invalidated its independent player');
    checks.push('repeated mount and independent asset lifetime');
    assert(failures.length === 0, failures.join('; '));
    return {checks, firstDrawMs, viewport:[innerWidth,innerHeight], pixelRatio:devicePixelRatio};
  } finally {
    capture?.destroy(); player?.destroy(); asset?.dispose(); host.remove();
  }
}
