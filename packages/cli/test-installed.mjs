import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// This exercises the distributed CLI and generated modules, never workspace aliases.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const release = resolve(process.argv[2] ?? join(repository, 'release'));
const artifacts = JSON.parse(readFileSync(join(release, 'artifacts.json'), 'utf8')).packages;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = join(repository, 'fixtures/ambient.float.choco');
const updated = join(repository, 'fixtures/ambient.bob.choco');
const temporary = mkdtempSync(join(tmpdir(), 'choco-installed-cli-'));
const npm = (args, cwd) => execFileSync('npm', args, { cwd, stdio: 'pipe' });

try {
  for (const target of ['web', 'react']) {
    const app = mkdtempSync(join(temporary, `${target}-`));
    const cliFile = join(release, artifacts['@chocopie-moments/cli'].file);
    const reactVersion = JSON.parse(readFileSync(join(repository, 'node_modules/react/package.json'), 'utf8')).version;
    const dependencies = { '@chocopie-moments/cli': `file:${cliFile}`,
      ...(target === 'react' ? { react: reactVersion, 'react-dom': reactVersion } : {}) };
    const devDependencies = target === 'react' ? Object.fromEntries(['@types/react', '@types/react-dom'].map(name =>
      [name, JSON.parse(readFileSync(join(repository, 'node_modules', name, 'package.json'), 'utf8')).version])) : {};
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: `installed-${target}`, private: true, type: 'module', dependencies, devDependencies }, null, 2));
    npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], app);
    const command = (args, ok = true) => {
      let output;
      try { output = execFileSync(process.execPath, [join(app, 'node_modules/@chocopie-moments/cli/dist/index.js'), ...args, '--json'], { cwd: app, encoding: 'utf8' }); }
      catch (error) { if (ok) throw error; output = error.stdout; }
      const result = JSON.parse(output);
      assert.equal(result.ok, ok, JSON.stringify(result));
      return result;
    };
    const inspected = command(['inspect', fixture]).result;
    const next = command(['inspect', updated]).result;
    const catalog = join(app, 'release.json');
    const packages = Object.fromEntries(['@chocopie-moments/runtime', '@chocopie-moments/react'].map(name => {
      const artifact = artifacts[name], file = join(release, artifact.file);
      assert.equal(hash(readFileSync(file)), artifact.sha256);
      return [name, { version: artifact.version, file, sha256: artifact.sha256 }];
    }));
    const capabilities = [...new Map([...inspected.manifest.required, ...next.manifest.required].map(capability => [capability.id, capability])).values()];
    writeFileSync(catalog, JSON.stringify({ version: 1, format: inspected.manifest.formatVersion,
      semantics: inspected.manifest.semanticsVersion, capabilities, packages }));
    const args = ['--project', app, '--name', 'moment', '--catalog', catalog];
    const before = readFileSync(join(app, 'package.json'));
    const preview = command(['add', fixture, ...args, '--dry-run']).result;
    assert.equal(preview.applied, false);
    assert.deepEqual(readFileSync(join(app, 'package.json')), before);
    assert.equal(existsSync(join(app, '.choco/installations.json')), false);
    command(['add', fixture, ...args, '--yes', '--offline']);
    assert.equal(command(['doctor', '--project', app]).result.healthy, true);
    const receipt = JSON.parse(readFileSync(join(app, '.choco/installations.json')));
    assert.equal(receipt.installations[0].target, target);
    assert.equal(receipt.installations[0].sha256, hash(readFileSync(fixture)));
    assert.equal(Object.keys(receipt.dependencies).includes('@chocopie-moments/react'), target === 'react');
    const unchanged = command(['add', fixture, ...args, '--yes', '--offline']).result;
    assert.deepEqual(unchanged.changed, []);

    const wrapper = join(app, `src/choco/moment.${target === 'react' ? 'tsx' : 'ts'}`);
    writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx',
      strict: true, skipLibCheck: true, noEmit: true, lib: ['ES2022', 'DOM'],
    }, include: ['src'] }));
    execFileSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(app, 'tsconfig.json')], { cwd: app, stdio: 'pipe' });
    const bundled = join(app, 'consuming-app.mjs');
    await build({ entryPoints: [wrapper], outfile: bundled, bundle: true, platform: 'node',
      format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
    if (target === 'react') {
      writeFileSync(join(app, 'ssr.mjs'), `import { createElement } from 'react';\nimport { renderToString } from 'react-dom/server';\nimport { Moment } from './consuming-app.mjs';\nconst html = renderToString(createElement(Moment, {label:'Moment'}));\nif (!html.includes('Loading artwork') || !html.includes('aria-busy="true"')) throw Error('SSR failed');\n`);
      execFileSync(process.execPath, [join(app, 'ssr.mjs')], { cwd: app, stdio: 'pipe' });
    } else {
      writeFileSync(join(app, 'imports.mjs'), `import { load, mount } from './consuming-app.mjs';\nif (typeof load !== 'function' || typeof mount !== 'function') throw Error('Missing vanilla adapter');\n`);
      execFileSync(process.execPath, [join(app, 'imports.mjs')], { cwd: app, stdio: 'pipe' });
    }

    command(['update', updated, ...args, '--yes', '--offline']);
    assert.equal(hash(readFileSync(join(app, 'assets/choco/moment.choco'))), hash(readFileSync(updated)));
    const generated = readFileSync(wrapper);
    writeFileSync(wrapper, '// Application edit\n');
    assert.equal(command(['update', fixture, ...args, '--yes'], false).error.code, 'conflict');
    assert.equal(readFileSync(wrapper, 'utf8'), '// Application edit\n');
    writeFileSync(wrapper, generated);
    command(['remove', ...args, '--yes', '--offline']);
    assert.equal(existsSync(wrapper), false);
    assert.equal(existsSync(join(app, 'assets/choco/moment.choco')), false);
    const final = JSON.parse(readFileSync(join(app, 'package.json')));
    assert.equal(final.dependencies['@chocopie-moments/runtime'], undefined);
    assert.equal(final.dependencies['@chocopie-moments/react'], undefined);
    assert.equal(command(['doctor', '--project', app]).result.healthy, true);
    console.log(`Packed CLI ${target}: dry-run, install, generated imports${target === 'react' ? '/SSR' : ''}, update, conflict preservation and removal passed.`);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
