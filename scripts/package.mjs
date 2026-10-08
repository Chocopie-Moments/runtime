import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const release = resolve('release');
mkdirSync(release, { recursive: true });
execFileSync('npm', ['run', 'check:spec'], { stdio: 'inherit' });
for (const name of ['codec', 'runtime', 'react', 'cli']) {
  rmSync(`packages/${name}/dist`, { recursive: true, force: true });
  mkdirSync(`packages/${name}/dist`, { recursive: true });
  copyFileSync('LICENSE', `packages/${name}/LICENSE`);
}
function notices(name, metadata) {
  const roots = new Set();
  for (const input of Object.keys(metadata.inputs)) {
    if (!input.includes('node_modules/')) continue;
    const start = input.lastIndexOf('node_modules/') + 'node_modules/'.length;
    const parts = input.slice(start).split('/');
    const name = parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
    const root = resolve(input.slice(0, start), name);
    roots.add(root);
  }
  for (const root of roots) {
    const info = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
    const supplied = `third-party/js/${info.name}-${info.version}`;
    const licenseRoot = existsSync(supplied) ? supplied : root;
    const licenses = readdirSync(licenseRoot).filter(file => /^(license|copying|notice)/i.test(file));
    if (!licenses.length) throw Error('Missing bundled dependency notice: '+info.name);
    const destination = `packages/${name}/dist/third-party/${info.name}`;
    mkdirSync(destination, { recursive: true });
    for (const file of licenses) cpSync(`${licenseRoot}/${file}`, `${destination}/${basename(file)}`, {recursive:true});
  }
}
const codec = await build({ entryPoints: ['packages/codec/src/index.ts'], outdir: 'packages/codec/dist', bundle: true, minify: true, metafile: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], target: 'es2022' });
notices('codec', codec.metafile);
execFileSync('npx', ['tsc', '-p', 'tsconfig.declarations.json'], { stdio: 'inherit' });
for (const name of ['index']) writeFileSync(`packages/codec/dist/${name}.d.ts`, `export * from './types/packages/codec/src/${name}.js';\n`);
const cli = await build({ entryPoints: ['packages/cli/src/index.ts'], outfile: 'packages/cli/dist/index.js', bundle: true, minify: true, metafile: true, format: 'esm', platform: 'node', target: 'node24', banner: { js: '#!/usr/bin/env node' } });
notices('cli', cli.metafile);
for (const name of ['choco.mjs','choco.wasm','build.json']) copyFileSync(`scripts/generated/choco-web/${name}`, `packages/runtime/dist/${name}`);
cpSync('third-party', 'packages/runtime/dist/third-party', { recursive: true });
const runtime = await build({ entryPoints: ['packages/runtime/src/index.ts'], outfile: 'packages/runtime/dist/index.js', bundle: true, minify: true, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['./choco.mjs'] });
notices('runtime', runtime.metafile);
await build({ entryPoints: ['packages/react/src/index.tsx'], outfile: 'packages/react/dist/index.js', bundle: true, minify: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['react', 'react/jsx-runtime', '@chocopie/runtime'], banner: { js: "'use client';" } });
for (const name of ['runtime', 'react']) {
  execFileSync('npx', ['tsc', '-p', `tsconfig.${name}.json`], { stdio: 'inherit' });
  writeFileSync(`packages/${name}/dist/index.d.ts`, `export * from './types/packages/${name}/src/index.js';\n`);
}
copyFileSync('packages/runtime/src/choco.d.mts', 'packages/runtime/dist/types/packages/runtime/src/choco.d.mts');
const packages = {};
for (const name of ['codec','runtime','react','cli']) {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', `./packages/${name}`, '--ignore-scripts', '--json', '--pack-destination', release], { encoding: 'utf8' }));
  const bytes = readFileSync(`${release}/${packed.filename}`);
  packages[packed.name] = { version: packed.version, file: packed.filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(`${release}/artifacts.json`, JSON.stringify({ source, dirty: !!execFileSync('git', ['status','--porcelain'], {encoding:'utf8'}).trim(), packages, releaseGates: JSON.parse(readFileSync('release-gates.json','utf8')) }, null, 2)+'\n');
const { CHOCO_CAPABILITIES, CHOCO_FORMAT_VERSION, CHOCO_SEMANTICS_VERSION } = await import('../packages/codec/dist/index.js');
const catalogPackages = Object.fromEntries(['@chocopie/runtime','@chocopie/react'].map(name => {
  const { version, file, sha256 } = packages[name];
  return [name, { version, file, sha256 }];
}));
writeFileSync(`${release}/catalog.json`, JSON.stringify({ version: 1, source, format: CHOCO_FORMAT_VERSION, semantics: CHOCO_SEMANTICS_VERSION,
  capabilities: [...CHOCO_CAPABILITIES].map(id => ({ id, version: 1 })), packages: catalogPackages,
}, null, 2)+'\n');
const receipt = JSON.parse(readFileSync(`${release}/artifacts.json`, 'utf8'));
const catalogBytes = readFileSync(`${release}/catalog.json`);
receipt.catalog = { file: 'catalog.json', bytes: catalogBytes.length, sha256: createHash('sha256').update(catalogBytes).digest('hex') };
writeFileSync(`${release}/artifacts.json`, JSON.stringify(receipt, null, 2)+'\n');
console.log(JSON.stringify(packages));
