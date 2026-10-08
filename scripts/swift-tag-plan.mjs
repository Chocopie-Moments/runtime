import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Prepare a deterministic manifest-only commit object. Never moves a ref, tag, worktree or remote. */
export function prepareSwiftTagPlan(repository, release) {
  const metadata = JSON.parse(readFileSync(join(release, 'SWIFT-PACKAGE.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(release, 'artifacts.json'), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const git = (args, options = {}) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', ...options }).trim();
  assert.equal(metadata.status, 'prepared-unpublished');
  assert.equal(receipt.dirty, false, 'Swift tag plan requires clean reviewed artifacts');
  assert.equal(metadata.source, receipt.source);
  assert.match(receipt.source, /^[a-f0-9]{40}$/);
  assert.match(metadata.version, /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/);
  assert.equal(metadata.manifest.file, 'Package.swift');
  assert.equal(metadata.binary.file, `choco-native-${metadata.version}.zip`);
  const url = `https://github.com/Chocopie-Moments/runtime/releases/download/v${metadata.version}/${metadata.binary.file}`;
  assert.equal(metadata.binary.url, url);
  const manifest = readFileSync(join(release, 'Package.swift'));
  const binary = readFileSync(join(release, metadata.binary.file));
  for (const [pin, bytes] of [[metadata.manifest, manifest], [metadata.binary, binary]]) {
    assert.equal(bytes.length, pin.bytes);
    assert.equal(hash(bytes), pin.sha256);
    assert.equal(receipt.native[pin.file].bytes, pin.bytes);
    assert.equal(receipt.native[pin.file].sha256, pin.sha256);
  }
  const portable = git(['show', `${receipt.source}:native/ios/Package.swift`]);
  const expected = portable.replace('.binaryTarget(name: "ChocoNative", path: "Artifacts/ChocoNative.xcframework")',
    `.binaryTarget(name: "ChocoNative", url: "${url}", checksum: "${metadata.binary.sha256}")`)
    .replace('.target(name: "Choco", dependencies: ["ChocoNative"], linkerSettings:',
      '.target(name: "Choco", dependencies: ["ChocoNative"], path: "native/ios/Sources/Choco", linkerSettings:');
  assert.equal(manifest.toString('utf8').trim(), expected, 'Swift manifest must contain only the reviewed URL/checksum/source-path changes');
  const temporary = mkdtempSync(join(tmpdir(), 'choco-swift-tag-index-'));
  try {
    const date = git(['show', '-s', '--format=%cI', receipt.source]);
    const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index'), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: 'Chocopie release', GIT_COMMITTER_NAME: 'Chocopie release',
      GIT_AUTHOR_EMAIL: 'release@chocopie.lol', GIT_COMMITTER_EMAIL: 'release@chocopie.lol' };
    const run = (args, options = {}) => git(args, { env, ...options });
    run(['read-tree', receipt.source]);
    const blob = run(['hash-object', '-w', '--stdin'], { input: manifest });
    run(['update-index', '--add', '--cacheinfo', `100644,${blob},Package.swift`]);
    const tree = run(['write-tree']);
    const changed = run(['diff', '--name-only', receipt.source, tree]);
    assert.equal(changed, 'Package.swift', 'Swift tag tree may change only the root manifest');
    const commit = run(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', receipt.source, '-m', `chore(release): pin Swift package for v${metadata.version}`]);
    return { status: 'prepared-unapproved', artifactSource: receipt.source, tag: `v${metadata.version}`, targetCommit: commit, tree,
      changedFiles: ['Package.swift'], binaryUrl: url, binarySha256: metadata.binary.sha256,
      remoteWrites: false, refsChanged: false };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function assertReviewedSwiftTag(plan, tag) {
  if (!tag || tag.object?.type !== 'commit' || tag.object.sha !== plan.targetCommit)
    throw new Error('Release tag must point at the reviewed manifest-only Swift commit.');
}
