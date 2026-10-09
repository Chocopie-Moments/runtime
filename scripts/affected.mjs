/**
 * Which CI scope a pull request needs. Nothing in this repository depends on the CLI, so a change
 * confined to packages/cli runs only the CLI job; documentation alone runs nothing; any other path
 * (codec, engine, adapters, fixtures, scripts, workflows, lockfiles) runs the full graph. Pushes,
 * dispatches and calls always run full, so release builds keep complete acceptance.
 */
import { execFileSync } from 'node:child_process';

export function scopeOf(paths) {
  const kinds = new Set(paths.map(path =>
    path.startsWith('packages/cli/') ? 'cli'
      : path.startsWith('docs/') || (/\.md$/.test(path) && !path.startsWith('packages/') && !path.startsWith('fixtures/')) ? 'docs'
        : 'full'));
  return kinds.has('full') ? 'full' : kinds.has('cli') ? 'cli' : 'docs';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.BASE_SHA;
  let scope = 'full';
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && /^[a-f0-9]{40}$/.test(base ?? '')) {
    const paths = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean);
    scope = scopeOf(paths);
    console.error(`${paths.length} changed paths: ${scope}`);
  }
  console.log(`scope=${scope}`);
}
