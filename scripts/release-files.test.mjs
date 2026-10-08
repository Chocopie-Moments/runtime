import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { reviewedReleaseFiles } from './release-files.mjs';
const version = '0.1.0-dev.0';
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'choco-release-allowlist-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const packages = Object.fromEntries(['codec', 'runtime', 'react', 'cli', 'react-native'].map(name =>
    [`@chocopie/${name}`, { file: `${name}.tgz`, version }]));
  const receipt = { packages, catalog: { file: 'catalog.json' }, native: { 'choco-android-sdk-release.aar': {} } };
  for (const name of [...Object.values(packages).map(pin => pin.file), 'catalog.json', 'artifacts.json', 'choco-android-sdk-release.aar'])
    writeFileSync(join(directory, name), 'reviewed');
  return { directory, receipt };
}
test('only attaches reviewed files while ignoring proof APKs and leftover directories', t => {
  const { directory, receipt } = setup(t);
  mkdirSync(join(directory, 'android-sdk'));
  writeFileSync(join(directory, 'proof.apk'), 'not a release');
  const result = reviewedReleaseFiles(directory, receipt, version);
  assert.equal(result.attachments.length, 8);
  assert(result.attachments.every(path => !path.endsWith('.apk') && !path.endsWith('android-sdk')));
});
test('rejects directory attachments before publication can start', t => {
  const { directory, receipt } = setup(t);
  rmSync(join(directory, 'choco-android-sdk-release.aar'));
  mkdirSync(join(directory, 'choco-android-sdk-release.aar'));
  assert.throws(() => reviewedReleaseFiles(directory, receipt, version), /regular file/);
});
test('rejects escaping package paths and unreviewed native attachments', t => {
  const { directory, receipt } = setup(t);
  receipt.packages['@chocopie/runtime'].file = '../outside.tgz';
  assert.throws(() => reviewedReleaseFiles(directory, receipt, version), /safe flat filenames/);
  receipt.packages['@chocopie/runtime'].file = 'runtime.tgz';
  receipt.native['proof.apk'] = {};
  assert.throws(() => reviewedReleaseFiles(directory, receipt, version), /Unexpected native/);
});
test('rejects symlinks pointing outside the reviewed directory', t => {
  const { directory, receipt } = setup(t);
  rmSync(join(directory, 'runtime.tgz'));
  symlinkSync(process.execPath, join(directory, 'runtime.tgz'));
  assert.throws(() => reviewedReleaseFiles(directory, receipt, version), /regular file/);
});
