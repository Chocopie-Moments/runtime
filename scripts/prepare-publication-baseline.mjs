/** Local review artifact only. No remote, publication, history rewrite, or approval is performed. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const destination = process.argv[2];
const init = process.argv[3] === '--init';
if (!destination || process.argv.slice(3).some(arg => arg !== '--init') || process.argv.length > 4)
  throw new Error('Usage: node scripts/prepare-publication-baseline.mjs <NEW-private-directory> [--init]');
const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
if (git('status', '--porcelain').length) throw new Error('Commit and review the complete source tree first. HEAD export requires a clean checkout.');
const source = git('rev-parse', 'HEAD').toString().trim();
const inventory = git('ls-tree', '-rz', '--full-tree', source).toString().split('\0').filter(Boolean).map(line => {
  const [header, path] = line.split('\t');
  const [mode, type, object] = header.split(' ');
  return { mode, type, object, path };
});
const roots = new Set(['.gitattributes', '.github', '.gitignore', 'AGENTS.md', 'IMPORT.json', 'LICENSE', 'NOTICE', 'README.md', 'docs', 'fixtures', 'native', 'package-lock.json', 'package.json', 'packages', 'release-gates.json', 'scripts', 'src', 'tests', 'third-party', 'tsconfig.declarations.json', 'tsconfig.json', 'tsconfig.react.json', 'tsconfig.runtime.json', 'vitest.config.ts']);
const excluded = /(?:^|\/)(?:\.git|node_modules|generated|target(?:-[^/]*)?|dist|release|\.env[^/]*|\.dev\.vars[^/]*)(?:\/|$)/;
// These generated validators are checked-in portable admission source, not build artifacts.
const validators = new Set(['src/codec/generated/validate.js', 'src/codec/generated/validate.d.ts']);
const omit = path => excluded.test(path) && !validators.has(path);
const files = inventory.filter(item => !omit(item.path));
for (const item of files) {
  if (!roots.has(item.path.split('/')[0]) || item.type !== 'blob' || !['100644', '100755'].includes(item.mode) || item.path.split('/').some(part => part === '..')) throw new Error(`Unreviewed inventory entry: ${item.path}`);
  if (item.path.startsWith('src/') && !/^src\/(codec|format)\//.test(item.path)) throw new Error(`Unexpected source owner: ${item.path}`);
  if (item.path.startsWith('packages/') && !/^packages\/(cli|codec|react|react-native|runtime)\//.test(item.path)) throw new Error(`Unexpected package owner: ${item.path}`);
  if (/(?:^|\/)(?:authoring|compiler|prompts?|brand|moments)(?:\/|$)/i.test(item.path)) throw new Error(`Product-owned path cannot enter this baseline: ${item.path}`);
}
const paths = new Set(files.map(item => item.path));
for (const path of validators) if (!paths.has(path)) throw new Error(`Missing portable admission source: ${path}`);
const read = path => git('show', `${source}:${path}`);
const json = path => JSON.parse(read(path));
for (const path of files.map(item => item.path).filter(path => path === 'package.json' || /^packages\/[^/]+\/package.json$/.test(path))) {
  if (json(path).private !== true) throw new Error(`Package publication must remain paused: ${path}`);
}
if (json('release-gates.json').ready !== false) throw new Error('Release gates must remain closed in this review baseline.');
for (const entry of json('fixtures/manifest.json')) {
  for (const key of ['asset', 'trace']) if (typeof entry[key] !== 'string' || !entry[key].startsWith('fixtures/') || !paths.has(entry[key])) throw new Error(`Fixture manifest references missing or unreviewed ${key}: ${entry.id}`);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileManifest = files.map(item => { const content = read(item.path); return { path: item.path, mode: item.mode, bytes: content.length, sha256: sha256(content) }; });
const archive = gzipSync(git('archive', '--format=tar', source, '--', ...files.map(item => item.path)), { level: 9 });
const output = resolve(destination);
// mkdir without recursive refuses an existing directory; backups are never overwritten.
mkdirSync(output, { mode: 0o700 });
writeFileSync(join(output, 'source.tar.gz'), archive, { mode: 0o600 });
const manifest = JSON.stringify({ reviewStatus: 'unapproved', source, historyIncluded: false, packagesPrivate: true, releaseReady: false, archive: { file: 'source.tar.gz', bytes: archive.length, sha256: sha256(archive) }, excluded: inventory.filter(item => omit(item.path)).map(item => item.path), files: fileManifest }, null, 2) + '\n';
writeFileSync(join(output, 'manifest.json'), manifest, { mode: 0o600 });
writeFileSync(join(output, 'manifest.sha256'), sha256(manifest) + '\n', { mode: 0o600 });
if (init) {
  const tree = join(output, 'source');
  mkdirSync(tree, { mode: 0o700 });
  for (const item of files) {
    const path = join(tree, item.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, read(item.path), { mode: item.mode === '100755' ? 0o700 : 0o600 });
  }
  const freshGit = (...args) => execFileSync('git', ['-C', tree, ...args], { stdio: 'pipe' });
  freshGit('init', '--initial-branch=main');
  freshGit('add', '--all');
  freshGit('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Chocopie publication review', '-c', 'user.email=review@chocopie.lol', 'commit', '-m', 'chore(runtime): establish publication review candidate');
  writeFileSync(join(output, 'baseline-commit.txt'), freshGit('rev-parse', 'HEAD'), { mode: 0o600 });
}
console.log(`Prepared private, unapproved source baseline at ${output}. No remote or publication was configured.`);
