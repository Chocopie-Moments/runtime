import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { prepareSwiftTagPlan, assertReviewedSwiftTag } from './swift-tag-plan.mjs';
function setup(t) {
  const repository = mkdtempSync(join(tmpdir(), 'choco-swift-plan-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  git(['init', '--initial-branch=main']);
  mkdirSync(join(repository, 'native/ios'), { recursive: true });
  const portable = readFileSync(new URL('../native/ios/Package.swift', import.meta.url), 'utf8');
  writeFileSync(join(repository, 'native/ios/Package.swift'), portable);
  git(['add', '.']);
  git(['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'chore(test): seed Swift plan source']);
  const source = git(['rev-parse', 'HEAD']);
  const release = join(repository, 'release');
  mkdirSync(release);
  const version = '0.1.0-dev.0';
  const binary = Buffer.from('reviewed native archive');
  const pin = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const file = `choco-native-${version}.zip`;
  const url = `https://github.com/Chocopie-Moments/runtime/releases/download/v${version}/${file}`;
  const manifest = portable.replace('.binaryTarget(name: "ChocoNative", path: "Artifacts/ChocoNative.xcframework")',
    `.binaryTarget(name: "ChocoNative", url: "${url}", checksum: "${pin(binary).sha256}")`)
    .replace('.target(name: "Choco", dependencies: ["ChocoNative"], linkerSettings:',
      '.target(name: "Choco", dependencies: ["ChocoNative"], path: "native/ios/Sources/Choco", linkerSettings:');
  writeFileSync(join(release, file), binary);
  writeFileSync(join(release, 'Package.swift'), manifest);
  const metadata = { status: 'prepared-unpublished', source, version, binary: { file, url, ...pin(binary) },
    manifest: { file: 'Package.swift', ...pin(Buffer.from(manifest)) } };
  const receipt = { source, dirty: false, native: { [file]: pin(binary), 'Package.swift': pin(Buffer.from(manifest)) } };
  writeFileSync(join(release, 'SWIFT-PACKAGE.json'), JSON.stringify(metadata));
  writeFileSync(join(release, 'artifacts.json'), JSON.stringify(receipt));
  return { repository, release, git, source };
}
test('prepares a reproducible manifest-only commit without moving any ref or worktree', t => {
  const { repository, release, git, source } = setup(t);
  const refs = git(['show-ref']);
  const status = git(['status', '--porcelain']);
  const plan = prepareSwiftTagPlan(repository, release);
  assert.deepEqual(prepareSwiftTagPlan(repository, release), plan);
  assert.equal(git(['rev-parse', 'HEAD']), source);
  assert.equal(git(['show-ref']), refs);
  assert.equal(git(['status', '--porcelain']), status);
  assert.equal(git(['show', '-s', '--format=%P', plan.targetCommit]), source);
  assert.equal(git(['diff-tree', '--no-commit-id', '--name-only', '-r', source, plan.targetCommit]), 'Package.swift');
  assert.equal(plan.refsChanged, false);
  assert.equal(plan.remoteWrites, false);
});
test('rejects altered prepared manifest before creating a plan', t => {
  const { repository, release } = setup(t);
  writeFileSync(join(release, 'Package.swift'), 'unexpected source');
  assert.throws(() => prepareSwiftTagPlan(repository, release));
});

test('requires an existing remote tag at the reviewed manifest-only commit', t => {
  const { repository, release, source } = setup(t);
  const plan = prepareSwiftTagPlan(repository, release);
  assert.throws(() => assertReviewedSwiftTag(plan, undefined), /reviewed manifest-only/);
  assert.throws(() => assertReviewedSwiftTag(plan, { object: { type: 'commit', sha: source } }), /reviewed manifest-only/);
  assert.throws(() => assertReviewedSwiftTag(plan, { object: { type: 'tag', sha: plan.targetCommit } }), /reviewed manifest-only/);
  assert.doesNotThrow(() => assertReviewedSwiftTag(plan, { object: { type: 'commit', sha: plan.targetCommit } }));
});

function publishFixture(t) {
  const fixture = setup(t);
  const { repository, release, source } = fixture;
  const pin = file => {
    const bytes = readFileSync(join(release, file));
    return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const receipt = JSON.parse(readFileSync(join(release, 'artifacts.json'), 'utf8'));
  receipt.releaseGates = { ready: true, blockers: [], format: 0, semantics: 1 };
  receipt.nativePlatforms = ['ios', 'android'];
  receipt.packages = {};
  const stage = join(repository, 'archive/package');
  mkdirSync(stage, { recursive: true });
  for (const name of ['codec', 'runtime', 'react', 'cli', 'react-native']) {
    const full = `@chocopie-moments/${name}`;
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: full, version: '0.1.0-dev.0', private: false }));
    const file = `${name}.tgz`;
    execFileSync('tar', ['-czf', join(release, file), '-C', join(repository, 'archive'), 'package']);
    receipt.packages[full] = { version: '0.1.0-dev.0', ...pin(file) };
  }
  writeFileSync(join(release, 'choco-android-sdk-release.aar'), 'reviewed SDK');
  receipt.native['choco-android-sdk-release.aar'] = pin('choco-android-sdk-release.aar');
  const packages = Object.fromEntries(['runtime', 'react', 'react-native'].map(name => {
    const { version, file, sha256 } = receipt.packages[`@chocopie-moments/${name}`];
    return [`@chocopie-moments/${name}`, { version, file, sha256 }];
  }));
  writeFileSync(join(release, 'catalog.json'), JSON.stringify({ source, format: 0, semantics: 1, packages }));
  receipt.catalog = pin('catalog.json');
  writeFileSync(join(release, 'artifacts.json'), JSON.stringify(receipt));
  const bin = join(repository, 'mock-tools');
  mkdirSync(bin);
  const log = join(repository, 'external-writes.log');
  writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
require('fs').appendFileSync(process.env.CHOCO_TEST_LOG, 'npm-write\n'); process.exit(99);
`);
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
if (process.env.CHOCO_TEST_TAG === 'missing') process.exit(1);
console.log(JSON.stringify({object:{type:'commit',sha:'0'.repeat(40)}}));
`);
  for (const name of ['npm', 'gh']) chmodSync(join(bin, name), 0o700);
  return { ...fixture, log, bin };
}
for (const failure of ['missing-plan', 'wrong-tag', 'missing-tag']) {
  test(`publication refuses ${failure} before the first npm write`, t => {
    const { repository, release, source, bin, log } = publishFixture(t);
    if (failure === 'missing-plan') rmSync(join(release, 'SWIFT-PACKAGE.json'));
    let error;
    try {
      execFileSync(process.execPath, [new URL('./publish.mjs', import.meta.url).pathname, release], {
        cwd: repository, encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_SHA: source,
          GITHUB_REPOSITORY: 'Chocopie-Moments/runtime', CHOCO_TEST_LOG: log,
          CHOCO_TEST_TAG: failure === 'missing-tag' ? 'missing' : 'wrong' },
      });
    } catch (caught) { error = caught; }
    assert(error, 'Publication unexpectedly succeeded');
    assert.match(error.stderr, failure === 'missing-plan' ? /SWIFT-PACKAGE.json/ : /review|manifest-only/i);
    assert.throws(() => readFileSync(log), /ENOENT/, 'No npm write may occur before Swift tag approval');
  });
}
