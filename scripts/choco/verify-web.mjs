/** Cross-target pixels through the same .choco archive and C controls. Build both targets first. */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const dir = resolve(process.env.CHOCO_WEB_BUILD ?? 'scripts/generated/choco-web');
const nativeBinary = process.env.CHOCO_NATIVE_FRAMES ?? 'native/choco-native/target/release/frames';
const { default: initialize } = await import(pathToFileURL(`${dir}/choco.mjs`).href);
const core = await initialize();
const error = core._malloc(512), changed = core._malloc(24);
const errorMessage = () => new TextDecoder().decode(core.HEAPU8.subarray(error, error + 512)).split('\0')[0];
const results = [];
const fixtures = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : ['flows', 'draws'].map(id => ({
  id, asset: resolve(`scripts/generated/choco-${id}/conformance/${id === 'flows' ? 'flows' : 'strokes'}.choco`),
  trace: resolve(`scripts/generated/choco-${id}/conformance/trace.json`),
}));
for (const fixture of fixtures) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(fixture.id)) throw new Error('Invalid fixture ID');
  const bytes = readFileSync(fixture.asset);
  const trace = JSON.parse(readFileSync(fixture.trace, 'utf8'));
  const destination = `${dir}/${fixture.id}`;
  mkdirSync(destination, { recursive: true });
  execFileSync(nativeBinary, [destination, fixture.trace], { input: bytes });
  const input = core._malloc(bytes.length);
  core.HEAPU8.set(bytes, input);
  const player = core._choco_player_create(input, bytes.length, 320, 320, false, error, 512);
  core._free(input);
  if (!player) throw new Error(errorMessage());
  try {
    let width = 320, height = 320;
    for (const [index, event] of trace.entries()) {
      let success = true, delta = 0;
      if (event.op === 'seek') success = core._choco_player_seek(player, event.seconds, error, 512);
      else if (event.op === 'trigger') success = core._choco_player_trigger(player, ['enter', 'hover', 'click'].indexOf(event.name), error, 512);
      else if (event.op === 'state') {
        const bytes = new TextEncoder().encode(event.name ?? '');
        const name = core._malloc(bytes.length || 1);
        core.HEAPU8.set(bytes, name);
        success = core._choco_player_state(player, name, bytes.length, event.restart ?? false, error, 512);
        core._free(name);
      } else if (event.op === 'advance') delta = event.seconds;
      else if (event.op === 'pause') success = core._choco_player_pause(player, event.paused, error, 512);
      else if (event.op === 'reducedMotion') success = core._choco_player_reduced_motion(player, event.reduced, error, 512);
      else if (event.op === 'look') success = core._choco_player_look(player, event.x !== null && event.y !== null, event.x ?? 0, event.y ?? 0, error, 512);
      else if (event.op === 'resize') { width = event.width; height = event.height; }
      else if (event.op === 'palette') {
        const colors = ['accent', 'secondary', 'ink', 'background'].map(key => {
          if (!/^#[0-9a-f]{6}$/i.test(event.colors[key])) throw new Error('Trace requires four opaque RGB palette colors');
          return Number.parseInt(event.colors[key].slice(1), 16);
        });
        success = core._choco_player_palette(player, ...colors, error, 512);
      } else throw new Error(`Unsupported trace operation ${event.op}`);
      if (!success) throw new Error(errorMessage());
      const pixels = core._choco_web_frame(player, delta, width, height, changed, error, 512);
      if (!pixels) throw new Error(errorMessage());
      const wasm = core.HEAPU8.slice(pixels, pixels + width * height * 4);
      const native = readFileSync(`${destination}/${index}.rgba`);
      if (native.length !== wasm.length) throw new Error('Frame dimensions differ');
      let differingChannels = 0, maxChannelDifference = 0;
      for (let i = 0; i < wasm.length; i++) {
        const difference = Math.abs(wasm[i] - native[i]);
        if (difference) differingChannels++;
        maxChannelDifference = Math.max(maxChannelDifference, difference);
      }
      const row = {fixture: fixture.id, index, event, width, height, differingChannels, maxChannelDifference, identical: differingChannels === 0,
        nativeSha256: createHash('sha256').update(native).digest('hex'), wasmSha256: createHash('sha256').update(wasm).digest('hex')};
      // Preserve failures for inspection; successful corpus frames retain hashes without gigabytes of copies.
      if (!row.identical || !process.argv[2]) writeFileSync(`${destination}/${index}.wasm.rgba`, wasm);
      else unlinkSync(`${destination}/${index}.rgba`);
      results.push(row);
      if (!row.identical) console.error(JSON.stringify(row));
    }
  } finally { core._choco_player_destroy(player); }
  console.log(JSON.stringify({ fixture: fixture.id, frames: trace.length, failures: results.filter(row => row.fixture === fixture.id && !row.identical).length }));
}
core._free(error); core._free(changed);
writeFileSync(process.argv[3] ?? `${dir}/${process.argv[2] ? 'corpus-parity' : 'parity'}.json`, JSON.stringify({
  wasmSha256: createHash('sha256').update(readFileSync(`${dir}/choco.wasm`)).digest('hex'),
  nativeSha256: createHash('sha256').update(readFileSync(nativeBinary)).digest('hex'), results,
}, null, 2));
if (results.some(row => !row.identical)) process.exitCode = 1;
