/** One fresh-process WASM sample. The caller alternates builds to limit ordering bias. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [directory, assetPath, state, sizeArgument] = process.argv.slice(2);
const size = Number(sizeArgument);
if (!directory || !assetPath || !state || !Number.isInteger(size) || size < 1 || size > 2048) {
  throw new Error('Usage: benchmark-web.mjs BUILD_DIRECTORY ASSET STATE SIZE');
}
const bytes = readFileSync(assetPath);
const start = performance.now();
const { default: initialize } = await import(pathToFileURL(resolve(directory, 'choco.mjs')).href);
const core = await initialize();
const initializeMs = performance.now() - start;
const error = core._malloc(512), changed = core._malloc(24);
const fail = () => {
  throw new Error(new TextDecoder().decode(core.HEAPU8.subarray(error, error + 512)).split('\0')[0]);
};
const loadStart = performance.now();
const input = core._malloc(bytes.length);
core.HEAPU8.set(bytes, input);
const player = core._choco_player_create(input, bytes.length, size, size, false, error, 512);
core._free(input);
if (!player) fail();
try {
  const encoded = new TextEncoder().encode(state);
  const name = core._malloc(encoded.length);
  core.HEAPU8.set(encoded, name);
  const success = core._choco_player_state(player, name, encoded.length, false, error, 512);
  core._free(name);
  if (!success) fail();
  let pixels = core._choco_web_frame(player, 0, size, size, changed, error, 512);
  if (!pixels) fail();
  const loadToFirstFrameMs = performance.now() - loadStart;
  const samples = [];
  for (let frame = 0; frame < 240; frame++) {
    const tick = performance.now();
    pixels = core._choco_web_frame(player, 1 / 60, size, size, changed, error, 512);
    samples.push(performance.now() - tick);
    if (!pixels) fail();
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({
    directory, assetPath, state, size, initializeMs, loadToFirstFrameMs,
    p50Ms: samples[Math.floor(samples.length * 0.5)],
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
    heapBytes: core.HEAPU8.length,
    frameSha256: createHash('sha256').update(core.HEAPU8.subarray(pixels, pixels + size * size * 4)).digest('hex'),
    wasmSha256: createHash('sha256').update(readFileSync(resolve(directory, 'choco.wasm'))).digest('hex'),
    samples,
  }));
} finally {
  core._choco_player_destroy(player);
  core._free(error);
  core._free(changed);
}
