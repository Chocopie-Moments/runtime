import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('exports required checked-in admission validators while excluding generated build outputs', t => {
  const root = mkdtempSync(join(tmpdir(), 'choco-baseline-owner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, 'repository');
  mkdirSync(repository);
  const write = (name, contents) => {
    const path = join(repository, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  };
  write('package.json', JSON.stringify({ private: true }));
  write('release-gates.json', JSON.stringify({ ready: false }));
  write('fixtures/manifest.json', '[]');
  write('src/codec/generated/validate.js', 'export const validateDocument = () => true;\n');
  write('src/codec/generated/validate.d.ts', 'export function validateDocument(value: unknown): boolean;\n');
  write('scripts/generated/build.json', '{"generatedBuildOutput":true}');
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  git(['init', '--initial-branch=main']);
  git(['add', '.']);
  git(['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'chore(test): seed portable baseline source']);
  const output = join(root, 'review');
  execFileSync(process.execPath, [new URL('./prepare-publication-baseline.mjs', import.meta.url).pathname, output, '--init'], { cwd: repository });
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  const files = manifest.files.map(record => record.path);
  for (const name of ['src/codec/generated/validate.js', 'src/codec/generated/validate.d.ts']) {
    assert(files.includes(name));
    assert.deepEqual(readFileSync(join(output, 'source', name)), readFileSync(join(repository, name)));
  }
  assert.deepEqual(manifest.excluded, ['scripts/generated/build.json']);
  assert.equal(manifest.historyIncluded, false);
  assert.equal(manifest.packagesPrivate, true);
  assert.equal(manifest.releaseReady, false);
  assert.equal(git(['rev-list', '--count', 'HEAD']), '1');
  assert.equal(execFileSync('git', ['remote', '-v'], { cwd: join(output, 'source'), encoding: 'utf8' }), '');
});
