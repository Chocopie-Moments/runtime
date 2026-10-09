import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Distributed installer proof; no native build or simulator execution is claimed by this script.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const profile = process.argv[3] ?? 'bare';
assert(['bare', 'expo'].includes(profile), 'Use bare or expo consumer profile.');
const expo = profile === 'expo';
const release = resolve(process.argv[2] ?? join(repository, 'release'));
const artifacts = JSON.parse(readFileSync(join(release, 'artifacts.json'), 'utf8')).packages;
const native = artifacts['@chocopie-moments/react-native'];
assert(native, 'Stage the reviewed native tarball before running the native installer proof.');
const hash = data => createHash('sha256').update(data).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'choco-installed-native-cli-'));
const npm = () => execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'pipe' });
const fixture = join(repository, 'fixtures/ambient.float.choco');
const next = join(repository, 'fixtures/ambient.bob.choco');
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'packed-native-installer-proof', private: true,
    dependencies: { react: '19.2.3', 'react-native': expo ? '0.86.3' : '0.87.1', ...(expo ? { expo: '57.0.17' } : {}), '@chocopie-moments/cli': `file:${join(release, artifacts['@chocopie-moments/cli'].file)}` },
    devDependencies: { '@types/react': '19.2.18', ...(expo ? {} : { '@react-native/metro-config': '0.87.1' }) },
  }, null, 2));
  npm();
  const metroPackage = expo ? 'expo/metro-config' : '@react-native/metro-config';
  const metroBefore = `const {getDefaultConfig} = require('${metroPackage}');\nconst config = getDefaultConfig(__dirname);\nconfig.transformer.chocoProof = true;\nmodule.exports = config;\n`;
  writeFileSync(join(root, 'metro.config.js'), metroBefore);
  const command = (args, ok = true) => {
    let result;
    try { result = execFileSync(process.execPath, [join(root, 'node_modules/@chocopie-moments/cli/dist/index.js'), ...args, '--json'], { cwd: root, encoding: 'utf8' }); }
    catch (error) { if (ok) throw error; result = error.stdout; }
    const parsed = JSON.parse(result); assert.equal(parsed.ok, ok, JSON.stringify(parsed)); return parsed;
  };
  const manifests = [fixture, next].map(path => command(['inspect', path]).result.manifest);
  const packageFile = join(release, native.file);
  assert.equal(hash(readFileSync(packageFile)), native.sha256);
  const catalog = join(root, 'release.json');
  writeFileSync(catalog, JSON.stringify({ version: 1, format: manifests[0].formatVersion, semantics: manifests[0].semanticsVersion,
    capabilities: [...new Map(manifests.flatMap(manifest => manifest.required).map(item => [item.id, item])).values()],
    packages: { '@chocopie-moments/react-native': { version: native.version, file: packageFile, sha256: native.sha256 } },
  }));
  const args = ['--project', root, '--name', 'moment', '--catalog', catalog, '--offline'];
  assert.equal(command(['add', fixture, '--sha256', hash(readFileSync(fixture)), ...args, '--dry-run']).result.applied, false);
  assert.equal(existsSync(join(root, '.choco/installations.json')), false);
  command(['add', fixture, '--sha256', hash(readFileSync(fixture)), ...args]);
  assert.equal(hash(readFileSync(join(root, 'assets/choco/moment.choco'))), hash(readFileSync(fixture)));
  assert.equal(command(['doctor', '--project', root]).result.healthy, true);
  const installed = JSON.parse(readFileSync(join(root, '.choco/installations.json')));
  assert.deepEqual(Object.keys(installed.dependencies), ['@chocopie-moments/react-native']);
  const require = createRequire(join(root, 'package.json'));
  const config = require('./metro.config.js');
  assert(config.resolver.assetExts.includes('choco'));
  assert.equal(config.transformer.chocoProof, true);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true }, include: ['src', 'App.tsx'] }));
  writeFileSync(join(root, 'App.tsx'), "import { useRef } from 'react';\nimport { Moment, type ChocoHandle } from './src/choco/moment';\nexport default function App() {\n  const player = useRef<ChocoHandle>(null);\n  return <Moment ref={player} playbackEnabled paused onError={error => { throw error; }} style={{width:32,height:32}} accessibilityLabel='Moment' />;\n}\n");
  execFileSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { cwd: root, stdio: 'pipe' });
  assert.deepEqual(command(['add', fixture, ...args]).result.changed, []);
  command(['update', next, ...args]);
  assert.equal(hash(readFileSync(join(root, 'assets/choco/moment.choco'))), hash(readFileSync(next)));
  const wrapper = join(root, 'src/choco/moment.tsx');
  const generated = readFileSync(wrapper);
  writeFileSync(wrapper, '// Application edit\n');
  assert.equal(command(['update', fixture, ...args], false).error.code, 'conflict');
  assert.equal(readFileSync(wrapper, 'utf8'), '// Application edit\n');
  writeFileSync(wrapper, generated);
  command(['remove', ...args]);
  assert.equal(readFileSync(join(root, 'metro.config.js'), 'utf8'), metroBefore);
  assert.equal(existsSync(wrapper), false);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).dependencies['@chocopie-moments/react-native'], undefined);
  console.log(`Packed ${profile} native CLI consumer: exact asset/pins, Metro preservation, generated application types, update/conflicts/removal passed. Native execution was not exercised.`);
} finally { rmSync(root, { recursive: true, force: true }); }
