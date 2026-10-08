/** Prepare npm resolution metadata before the separately offline consumer proofs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const receipt = JSON.parse(readFileSync('release/artifacts.json', 'utf8'));
const development = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies;
const tarballs = Object.values(receipt.packages).map(pin => {
  assert.match(pin.file, /^[a-zA-Z0-9_.-]+\.tgz$/);
  const path = resolve('release', pin.file);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, pin.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  return path;
});
const peers = ['react', 'react-dom', '@types/react', '@types/react-dom'].map(name => {
  assert.match(development[name], /^\d+\.\d+\.\d+$/);
  return `${name}@${development[name]}`;
});
const directory = mkdtempSync(join(tmpdir(), 'choco-cache-preparation-'));
try {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs, ...peers], {
    cwd: directory, stdio: 'inherit',
  });
  console.log('Prepared npm cache; subsequent packed consumer proofs remain offline.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
