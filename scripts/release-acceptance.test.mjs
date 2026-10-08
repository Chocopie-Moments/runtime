import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertResolvedSwiftPackage, verifyPublishedRelease } from './release-acceptance.mjs';
import { prepareSwiftTagPlan } from './swift-tag-plan.mjs';
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'choco-resolved-acceptance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, '.build/artifacts/runtime/ChocoNative/ChocoNative.xcframework');
  mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'Info.plist'), 'framework');
  const plan = { targetCommit: 'a'.repeat(40), binaryUrl: 'https://example.invalid/native.zip', binarySha256: 'b'.repeat(64) };
  const state = { object: { dependencies: [{ packageRef: { identity: 'runtime' }, state: { checkoutState: { revision: plan.targetCommit } } }],
    artifacts: [{ targetName: 'ChocoNative', path, source: { type: 'remote', url: plan.binaryUrl, checksum: plan.binarySha256 } }] } };
  return { directory, plan, state };
}
test('accepts the exact resolved tag and installed checksum-pinned binary', t => {
  const { directory, plan, state } = setup(t);
  assert.doesNotThrow(() => assertResolvedSwiftPackage(state, plan, directory));
});
test('rejects wrong tag checkout, missing binary and changed remote checksum', t => {
  const { directory, plan, state } = setup(t);
  const wrong = structuredClone(state); wrong.object.dependencies[0].state.checkoutState.revision = 'c'.repeat(40);
  assert.throws(() => assertResolvedSwiftPackage(wrong, plan, directory), /approved tag/);
  const missing = structuredClone(state); missing.object.artifacts = [];
  assert.throws(() => assertResolvedSwiftPackage(missing, plan, directory), /binary target/);
  state.object.artifacts[0].source.checksum = 'd'.repeat(64);
  assert.throws(() => assertResolvedSwiftPackage(state, plan, directory));
});

test('failed real-resolution command never creates passed acceptance evidence', t => {
  const repository = mkdtempSync(join(tmpdir(), 'choco-acceptance-failure-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '--initial-branch=main']);
  mkdirSync(join(repository, 'native/ios'), { recursive: true });
  const portable = readFileSync(new URL('../native/ios/Package.swift', import.meta.url), 'utf8');
  writeFileSync(join(repository, 'native/ios/Package.swift'), portable);
  git(['add', '.']);
  git(['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'chore(test): seed acceptance source']);
  const source = git(['rev-parse', 'HEAD']), release = join(repository, 'release');
  mkdirSync(release);
  const binary = Buffer.from('reviewed binary');
  const pin = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const file = 'choco-native-1.0.0.zip';
  const url = `https://github.com/Chocopie-Moments/runtime/releases/download/v1.0.0/${file}`;
  const manifest = portable.replace('.binaryTarget(name: "ChocoNative", path: "Artifacts/ChocoNative.xcframework")',
    `.binaryTarget(name: "ChocoNative", url: "${url}", checksum: "${pin(binary).sha256}")`)
    .replace('.target(name: "Choco", dependencies: ["ChocoNative"], linkerSettings:', '.target(name: "Choco", dependencies: ["ChocoNative"], path: "native/ios/Sources/Choco", linkerSettings:');
  writeFileSync(join(release, file), binary); writeFileSync(join(release, 'Package.swift'), manifest);
  writeFileSync(join(release, 'SWIFT-PACKAGE.json'), JSON.stringify({ status: 'prepared-unpublished', source, version: '1.0.0',
    binary: { file, url, ...pin(binary) }, manifest: { file: 'Package.swift', ...pin(Buffer.from(manifest)) } }));
  writeFileSync(join(release, 'artifacts.json'), JSON.stringify({ source, dirty: false, catalog: { sha256: 'a'.repeat(64) },
    native: { [file]: pin(binary), 'Package.swift': pin(Buffer.from(manifest)) } }));
  const plan = prepareSwiftTagPlan(repository, release);
  const previous = Object.fromEntries(['GITHUB_SHA', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID'].map(name => [name, process.env[name]]));
  Object.assign(process.env, { GITHUB_SHA: source, GITHUB_REPOSITORY: 'Chocopie-Moments/runtime', GITHUB_RUN_ID: '123' });
  t.after(() => { for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  const output = join(repository, 'release-acceptance.json');
  let resolutions = 0;
  const execute = (command, args) => {
    if (command === 'swift') { resolutions++; throw new Error('Resolution failed'); }
    if (args[0] === 'api') return JSON.stringify({ object: { type: 'commit', sha: plan.targetCommit } });
    writeFileSync(join(args.at(-1), file), binary);
  };
  assert.throws(() => verifyPublishedRelease(repository, release, output, execute), /Resolution failed/);
  assert.equal(resolutions, 1);
  assert.equal(existsSync(output), false);
  const accepted = verifyPublishedRelease(repository, release, output, (command, args) => {
    if (command !== 'swift') return execute(command, args);
    const directory = args[2];
    const artifactPath = join(directory, '.build/artifacts/runtime/ChocoNative/ChocoNative.xcframework');
    mkdirSync(artifactPath, { recursive: true }); writeFileSync(join(artifactPath, 'Info.plist'), 'framework');
    writeFileSync(join(directory, '.build/workspace-state.json'), JSON.stringify({ object: {
      dependencies: [{ packageRef: { identity: 'runtime' }, state: { checkoutState: { revision: plan.targetCommit } } }],
      artifacts: [{ targetName: 'ChocoNative', path: artifactPath, source: { type: 'remote', url, checksum: pin(binary).sha256 } }],
    } }));
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.source, source);
  assert.equal(accepted.swift.tagCommit, plan.targetCommit);
  assert.equal(accepted.swift.packageResolved, true);
  assert.equal(accepted.artifactsSha256, pin(readFileSync(join(release, 'artifacts.json'))).sha256);
  assert.deepEqual(JSON.parse(readFileSync(output)), accepted);
});

test('parses a real SwiftPM local tagged checkout and installed binary without compiling native code', { skip: process.platform !== 'darwin' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'choco-swift-local-parser-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dependency = join(root, 'runtime'), consumer = join(root, 'consumer');
  mkdirSync(join(dependency, 'Sources/Choco'), { recursive: true });
  mkdirSync(join(dependency, 'ChocoNative.xcframework/ios-arm64/ChocoNative.framework'), { recursive: true });
  mkdirSync(consumer);
  const framework = join(dependency, 'ChocoNative.xcframework');
  writeFileSync(join(framework, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundlePackageType</key><string>XFWK</string><key>XCFrameworkFormatVersion</key><string>1.0</string>
<key>AvailableLibraries</key><array><dict><key>LibraryIdentifier</key><string>ios-arm64</string><key>LibraryPath</key><string>ChocoNative.framework</string>
<key>SupportedArchitectures</key><array><string>arm64</string></array><key>SupportedPlatform</key><string>ios</string></dict></array></dict></plist>`);
  writeFileSync(join(framework, 'ios-arm64/ChocoNative.framework/ChocoNative'), 'synthetic nonexecutable binary; resolution only');
  writeFileSync(join(dependency, 'Sources/Choco/Choco.swift'), 'public struct Choco {}\n');
  writeFileSync(join(dependency, 'Package.swift'), `// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "Choco", platforms: [.iOS(.v16)], products: [.library(name: "Choco", targets: ["Choco"])],
 targets: [.binaryTarget(name: "ChocoNative", path: "ChocoNative.xcframework"), .target(name: "Choco", dependencies: ["ChocoNative"])])
`);
  const git = args => execFileSync('git', args, { cwd: dependency, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '--initial-branch=main']); git(['add', '.']);
  git(['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'chore(test): seed local Swift resolution']);
  git(['-c', 'tag.gpgsign=false', 'tag', 'v1.0.0']);
  const targetCommit = git(['rev-parse', 'HEAD']);
  writeFileSync(join(consumer, 'Package.swift'), `// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "Consumer", dependencies: [.package(url: "file://${dependency}", revision: "v1.0.0")])
`);
  execFileSync('swift', ['package', '--package-path', consumer, '--cache-path', join(root, 'cache'), 'resolve'], { stdio: 'pipe', timeout: 60_000 });
  const state = JSON.parse(readFileSync(join(consumer, '.build/workspace-state.json')));
  const checkout = state.object.dependencies.find(item => item.packageRef.identity === 'runtime');
  assert.equal(checkout.state.checkoutState.revision, targetCommit);
  const artifact = state.object.artifacts.find(item => item.targetName === 'ChocoNative');
  assert.equal(artifact.source.type, 'local');
  assert(existsSync(join(artifact.path, 'Info.plist')));
  assert.throws(() => assertResolvedSwiftPackage(state, { targetCommit }, consumer), /remote/);
});
