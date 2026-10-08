import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { prepareSwiftTagPlan, assertReviewedSwiftTag } from './swift-tag-plan.mjs';

export function assertResolvedSwiftPackage(state, plan, packageDirectory) {
  const dependencies = state.object?.dependencies ?? [];
  assert(dependencies.some(item => item.packageRef?.identity === 'runtime' && item.state?.checkoutState?.revision === plan.targetCommit), 'Swift did not resolve the approved tag commit');
  const artifact = (state.object?.artifacts ?? []).find(item => item.targetName === 'ChocoNative');
  assert(artifact, 'Swift did not install the ChocoNative binary target');
  // SwiftPM WorkspaceStateStorage encodes remote artifact source as flat fields.
  assert.equal(artifact.source?.type, 'remote');
  assert.equal(artifact.source?.url, plan.binaryUrl);
  assert.equal(artifact.source?.checksum, plan.binarySha256);
  const root = realpathSync(packageDirectory);
  const path = realpathSync(artifact.path);
  assert(!relative(root, path).startsWith('..'), 'Resolved Swift artifact escaped the consuming package');
  assert(existsSync(join(path, 'Info.plist')), 'Resolved XCFramework has no Info.plist');
}

/** Actual postpublication acceptance. No passed receipt exists if any check fails. */
export function verifyPublishedRelease(repository, release, output, execute = execFileSync) {
  const receiptBytes = readFileSync(join(release, 'artifacts.json'));
  const receipt = JSON.parse(receiptBytes);
  const plan = prepareSwiftTagPlan(repository, release);
  assert.equal(receipt.source, process.env.GITHUB_SHA);
  assert.equal(process.env.GITHUB_REPOSITORY, 'Chocopie-Moments/runtime');
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/);
  const run = (command, args, options = {}) => execute(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
  const tag = JSON.parse(run('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/git/ref/tags/${plan.tag}`]));
  assertReviewedSwiftTag(plan, tag);
  const temporary = mkdtempSync(join(tmpdir(), 'choco-published-acceptance-'));
  try {
    const metadata = JSON.parse(readFileSync(join(release, 'SWIFT-PACKAGE.json')));
    run('gh', ['release', 'download', plan.tag, '--repo', process.env.GITHUB_REPOSITORY, '--pattern', metadata.binary.file, '--dir', temporary]);
    const binary = readFileSync(join(temporary, metadata.binary.file));
    assert.equal(binary.length, metadata.binary.bytes);
    assert.equal(createHash('sha256').update(binary).digest('hex'), plan.binarySha256);
    mkdirSync(join(temporary, 'Sources/Probe'), { recursive: true });
    writeFileSync(join(temporary, 'Sources/Probe/main.swift'), 'import Choco\n');
    writeFileSync(join(temporary, 'Package.swift'), `// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ReleaseAcceptance", platforms: [.iOS(.v16)], dependencies: [
  .package(url: "https://github.com/${process.env.GITHUB_REPOSITORY}.git", revision: "${plan.tag}")
], targets: [.executableTarget(name: "Probe", dependencies: [.product(name: "Choco", package: "runtime")])])
`);
    run('swift', ['package', '--package-path', temporary, 'resolve'], { timeout: 300_000 });
    const state = JSON.parse(readFileSync(join(temporary, '.build/workspace-state.json')));
    assertResolvedSwiftPackage(state, plan, temporary);
    const acceptance = { format: 1, status: 'accepted', source: receipt.source, version: metadata.version,
      catalogSha256: receipt.catalog.sha256, artifactsSha256: createHash('sha256').update(receiptBytes).digest('hex'),
      swift: { tag: plan.tag, tagCommit: plan.targetCommit, packageResolved: true, xcframeworkSha256: plan.binarySha256 },
      workflow: { repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID } };
    writeFileSync(output, JSON.stringify(acceptance, null, 2) + '\n', { flag: 'wx' });
    return acceptance;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname)
  verifyPublishedRelease(process.cwd(), resolve(process.argv[2]), resolve(process.argv[3]));
