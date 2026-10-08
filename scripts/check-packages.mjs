import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const receipt = JSON.parse(readFileSync('release/artifacts.json', 'utf8'));
const directory = mkdtempSync(join(tmpdir(), 'choco-packed-'));
try {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const tarballs = Object.values(receipt.packages).map(p => {
    const path = resolve('release', p.file);
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== p.sha256) throw Error('Artifact digest mismatch');
    return path;
  });
  const development = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies;
  // A runtime-only consumer must resolve public declarations without codec/CLI
  // dependencies or skipLibCheck hiding missing type imports.
  const runtime = resolve('release', receipt.packages['@chocopie/runtime'].file);
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', runtime], {cwd:directory, stdio:'inherit'});
  writeFileSync(join(directory, 'consumer.ts'), `
    import { loadChoco } from '@chocopie/runtime';
    const asset = await loadChoco(new Uint8Array());
    const name: string = asset.manifest.name;
    const frames = asset.frames({ width: 100, height: 100 });
    const pixels: Uint8ClampedArray = frames.render().pixels;
    void [name, pixels];
  `);
  execFileSync(resolve('node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], {cwd:directory, stdio:'inherit'});
  execFileSync('npm', ['install','--offline','--ignore-scripts','--no-audit','--no-fund',...tarballs, `react@${development.react}`, `react-dom@${development['react-dom']}`], { cwd: directory, stdio:'inherit' });
  writeFileSync(join(directory, 'verify.mjs'), `
    import { readFileSync } from 'node:fs';
    import { decodeChoco, encodeChoco } from '@chocopie/codec';
    import initialize from '@chocopie/runtime/core';
    const bytes = readFileSync(process.argv[2]);
    const decoded = await decodeChoco(bytes);
    if (!Buffer.from(await encodeChoco(decoded.document)).equals(bytes)) throw Error('Codec round-trip differs');
    globalThis.fetch = () => { throw Error('Offline playback must not fetch a service'); };
    const core = await initialize();
    const error = core._malloc(512), changed = core._malloc(24), input = core._malloc(bytes.length);
    core.HEAPU8.set(bytes,input);
    const player = core._choco_player_create(input,bytes.length,160,160,false,error,512);
    core._free(input);
    if (!player) throw Error('Packed engine rejected asset');
    const pixels = core._choco_web_frame(player,.23,160,160,changed,error,512);
    if (!pixels || !core.HEAPU8.subarray(pixels,pixels+160*160*4).some(v=>v)) throw Error('Packed engine did not draw');
    core._choco_player_destroy(player);core._free(error);core._free(changed);
    console.log('Packed codec and WASM engine load and render offline');
  `);
  execFileSync('node', ['verify.mjs', resolve('fixtures/ambient.sway.choco')], { cwd:directory, stdio:'inherit' });
  execFileSync('node', ['verify.mjs', resolve('fixtures/admission/kind.waiting.choco')], { cwd:directory, stdio:'inherit' });
  execFileSync('node', ['verify.mjs', resolve('fixtures/admission/kind.custom.choco')], { cwd:directory, stdio:'inherit' });
  execFileSync('node', [join(directory,'node_modules/@chocopie/cli/dist/index.js'),'inspect',resolve('fixtures/ambient.sway.choco'),'--json'], { cwd:directory, stdio:'inherit' });
  writeFileSync(join(directory, 'public-api.mjs'), `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { loadChoco } from '@chocopie/runtime';
    import { createElement } from 'react';
    import { renderToString } from 'react-dom/server';
    import { Choco } from '@chocopie/react';
    globalThis.fetch = () => { throw Error('Offline playback must not fetch a service'); };
    const bytes = readFileSync(process.argv[2]);
    const asset = await loadChoco(bytes);
    const first = asset.frames({width:160,height:160});
    const second = asset.frames({width:160,height:160});
    asset.dispose();
    const frame = first.seekSeconds(.23);
    assert(frame.pixels.some(value=>value));
    assert.equal(frame.width,160);
    const before = frame.pixels.slice();
    first.advance(.2);
    assert.deepEqual(frame.pixels,before);
    assert.equal(second.currentTime,0);
    first.destroy();first.destroy();
    assert.throws(()=>first.render(),/disposed/);
    assert(second.render().pixels.some(value=>value));
    second.destroy();
    const html = renderToString(createElement(Choco,{src:'/local.choco',label:'A shared moment'}));
    assert(html.includes('data-choco-status="loading"'));
    console.log('Packed public API renders offline, retains owned frames, isolates players and imports during React SSR');
  `);
  execFileSync('node', ['public-api.mjs', resolve('fixtures/ambient.sway.choco')], {cwd:directory, stdio:'inherit'});
} finally { rmSync(directory,{recursive:true,force:true}); }
execFileSync('node', ['packages/cli/test-installed.mjs'], {stdio:'inherit'});
