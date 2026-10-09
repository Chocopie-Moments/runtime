/**
 * Beside a CLI-only pack, stages the latest published release's runtime and React tarballs, checked
 * against that release's artifacts.json, so the packed CLI is exercised against what it installs.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release');
const repository = process.env.GITHUB_REPOSITORY ?? 'Chocopie-Moments/runtime';
const latest = await (await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } })).json();
if (!/^v\d+\.\d+\.\d+$/.test(latest.tag_name ?? '')) throw Error('No published runtime release to stage.');
const download = async name => {
  const response = await fetch(`https://github.com/${repository}/releases/download/${latest.tag_name}/${name}`);
  if (!response.ok) throw Error(`Missing release file ${name}`);
  return Buffer.from(await response.arrayBuffer());
};
const released = JSON.parse((await download('artifacts.json')).toString('utf8'));
const receipt = JSON.parse(readFileSync(resolve(directory, 'artifacts.json'), 'utf8'));
for (const name of ['@chocopie-moments/runtime', '@chocopie-moments/react']) {
  const pin = released.packages[name];
  const bytes = await download(pin.file);
  if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw Error(`Released artifact integrity failed: ${pin.file}`);
  writeFileSync(resolve(directory, pin.file), bytes);
  receipt.packages[name] = pin;
}
writeFileSync(resolve(directory, 'artifacts.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Staged ${latest.tag_name} runtime and React beside the packed CLI.`);
