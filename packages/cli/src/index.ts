import { parseArgs } from 'node:util';
import { lstatSync, readFileSync } from 'node:fs';
import { decodeChoco } from '../../../src/codec/codec.ts';
import { CHOCO_LIMITS } from '../../../src/codec/archive.ts';
import { fetchChoco } from '../../../src/codec/load.ts';
import { apply, assertRecovered, CliError, digest, locked, recover, releaseStaleLock } from './files.ts';
import { doctor, planAdd, planRemove } from './plan.ts';
import { installPackages, project } from './project.ts';
import { pinnedDownload } from './catalog.ts';

async function asset(source: string, sha256?: string, offline = false) {
  if (source.startsWith('https://')) {
    if (offline) throw new CliError('offline', 'Supply a local .choco file in offline mode.');
    return sha256 === undefined ? fetchChoco(source) : pinnedDownload(source, sha256, CHOCO_LIMITS.compressed);
  }
  if (source.includes('://')) throw new CliError('source', 'Use a local .choco file or an HTTPS asset URL.');
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.size > CHOCO_LIMITS.compressed) throw new CliError('source', 'Choose a regular .choco file under the compressed-size limit.');
  const data = readFileSync(source);
  if (sha256 !== undefined && digest(data) !== sha256) throw new CliError('integrity', 'The moment asset failed its SHA-256 check.');
  return data;
}
function options() {
  const parsed = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string', default: '.' }, name: { type: 'string' }, catalog: { type: 'string' },
    sha256: { type: 'string' }, 'catalog-sha256': { type: 'string' },
    json: { type: 'boolean' }, yes: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, offline: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  return { ...parsed.values, command: parsed.positionals[0], source: parsed.positionals[1], extras: parsed.positionals.slice(2) };
}
const help = 'choco inspect <file> | add <file> | update <file> | remove | doctor | recover\n  --project <app> --name <name> --catalog <release.json-or-https-url> --catalog-sha256 <hash> --sha256 <asset-hash> --dry-run --yes --json --offline';
async function run() {
  const args = options();
  if (args.help || args.command === undefined) return { help };
  if (args.extras.length > 0) throw new CliError('arguments', 'Too many positional arguments. Use --help.');
  if (args.command === 'inspect') {
    if (args.source === undefined) throw new CliError('arguments', 'inspect requires a .choco file.');
    const value = await asset(args.source, args.sha256, args.offline);
    const decoded = await decodeChoco(value);
    return { sha256: digest(value), manifest: decoded.manifest, attribution: decoded.attribution };
  }
  if (!['add', 'update', 'remove', 'doctor', 'recover'].includes(args.command)) throw new CliError('arguments', `Unknown command: ${args.command}. Use --help.`);
  const app = project(args.project);
  if (args.command === 'recover') {
    if (!args.yes || args['dry-run']) throw new CliError('confirmation', 'Recovery changes journaled files or retries dependency installation. Run recover --yes to proceed.');
    releaseStaleLock(app.root);
    return locked(app.root, () => ({ recovery: recover(app.root, () => installPackages(app.root, args.offline ?? false)) }));
  }
  assertRecovered(app.root);
  if (args.command === 'doctor') return doctor(app);
  if (args.name === undefined || !/^[a-z][a-z0-9-]{0,47}$/.test(args.name)) throw new CliError('arguments', 'Supply --name using a lowercase letter followed by up to 47 lowercase letters, digits or hyphens.');
  if (args.command !== 'remove' && args.source === undefined) throw new CliError('arguments', `${args.command} requires a .choco file.`);
  const plan = args.command === 'remove' ? planRemove(app, args.name) : await planAdd(app, args.name, await asset(args.source!, args.sha256, args.offline), args.catalog, args.command === 'update', { sha256: args['catalog-sha256'], offline: args.offline });
  const summary = { command: args.command, changed: plan.changes.map(change => ({ path: change.path, action: change.after === null ? 'remove' : change.before === null ? 'create' : 'update' })), preserved: plan.preserved,
    ...(app.target !== 'react-native' ? {} : { native: { executionVerified: false, nextSteps: ['Run pod install in ios for an iOS application.', 'Rebuild the native application; installing JavaScript dependencies does not link the native view.', 'Android host execution remains a separate verification gate.'] } }),
  };
  if (args['dry-run']) return { ...summary, applied: false };
  if (!args.yes) throw new CliError('confirmation', 'Review the plan with --dry-run, then run with --yes. User edits are never overwritten.');
  if (plan.changes.length > 0) locked(app.root, () => apply(app.root, plan.changes, () => { if (plan.packages) installPackages(app.root, args.offline ?? false); }));
  return { ...summary, applied: true };
}
try {
  const result = await run();
  const unhealthy = 'healthy' in result && result.healthy === false;
  process.stdout.write(`${JSON.stringify({ version: 1, ok: !unhealthy, result }, null, process.argv.includes('--json') ? undefined : 2)}\n`);
  if (unhealthy) process.exitCode = 1;
} catch (error) {
  const code = error instanceof CliError ? error.code : 'invalid';
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ version: 1, ok: false, error: { code, message } })}\n`);
  process.exitCode = 1;
}
