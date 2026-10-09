import { parseArgs } from 'node:util';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { decodeChoco } from '../../../src/codec/codec.ts';
import { CHOCO_LIMITS } from '../../../src/codec/archive.ts';
import { apply, assertRecovered, CliError, digest, locked, recover, releaseStaleLock } from './files.ts';
import { doctor, planAdd, planRemove } from './plan.ts';
import { installPackages, project } from './project.ts';
import { MOMENT_ID, resolveMoment } from './resolve.ts';
import { report } from './report.ts';

type Source = { data: Buffer; name?: string; catalog?: { url: string; sha256: string } };
/** A moment comes from Chocopie by its id, or from a local .choco file with its own name and catalog. */
async function source(value: string, args: ReturnType<typeof options>): Promise<Source> {
  if (MOMENT_ID.test(value) && !existsSync(value)) {
    if (args.sha256 !== undefined || args.catalog !== undefined || args['catalog-sha256'] !== undefined)
      throw new CliError('arguments', 'A moment id pins its own asset and catalog. Drop --sha256 and --catalog.');
    return resolveMoment(value, args.offline);
  }
  if (value.includes('://')) throw new CliError('source', 'Use the moment id from Chocopie or a local .choco file.');
  const stat = lstatSync(value, { throwIfNoEntry: false });
  if (stat === undefined) throw new CliError('source', `No moment id or .choco file named ${value}. Copy the command again from Use in Chocopie.`);
  if (!stat.isFile() || stat.size > CHOCO_LIMITS.compressed) throw new CliError('source', 'Choose a regular .choco file under the compressed-size limit.');
  const data = readFileSync(value);
  if (args.sha256 !== undefined && digest(data) !== args.sha256) throw new CliError('integrity', 'The moment asset failed its SHA-256 check.');
  return { data };
}
function options() {
  const parsed = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string', default: '.' }, name: { type: 'string' }, catalog: { type: 'string' },
    sha256: { type: 'string' }, 'catalog-sha256': { type: 'string' },
    json: { type: 'boolean' }, yes: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, offline: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  return { ...parsed.values, command: parsed.positionals[0], source: parsed.positionals[1], extras: parsed.positionals.slice(2) };
}
const help = `Usage:
  choco add <moment-id>       Add a moment from Chocopie to the app in this folder
  choco add <file.choco> --name <name> --catalog <catalog>
  choco update <moment-id|file.choco> [--name <name>]
  choco remove --name <name>
  choco doctor                Check installed moments
  choco inspect <moment-id|file.choco>
  choco recover --yes         Finish or undo an interrupted install

Options:
  --project <folder>   The app to change (default: this folder)
  --dry-run            Show what would change without changing anything
  --json               Machine-readable output
  --offline            Use only local files
  --sha256 <hash>  --catalog <release.json or HTTPS URL>  --catalog-sha256 <hash>`;
async function run(args: ReturnType<typeof options>) {
  if (args.help || args.command === undefined) return { help };
  if (args.extras.length > 0) throw new CliError('arguments', 'Too many positional arguments. Use --help.');
  if (args.command === 'inspect') {
    if (args.source === undefined) throw new CliError('arguments', 'inspect requires a moment id or a .choco file.');
    const { data } = await source(args.source, args);
    const decoded = await decodeChoco(data);
    return { sha256: digest(data), manifest: decoded.manifest, attribution: decoded.attribution };
  }
  if (!['add', 'update', 'remove', 'doctor', 'recover'].includes(args.command)) throw new CliError('arguments', `Unknown command: ${args.command}. Use --help.`);
  if (args.yes && args.command !== 'recover') throw new CliError('arguments', `${args.command} applies without --yes. Add --dry-run to preview it instead.`);
  const app = project(args.project);
  if (args.command === 'recover') {
    if (!args.yes || args['dry-run']) throw new CliError('confirmation', 'Recovery changes journaled files or retries dependency installation. Run recover --yes to proceed.');
    releaseStaleLock(app.root);
    return locked(app.root, () => ({ recovery: recover(app.root, () => installPackages(app.root, args.offline ?? false)) }));
  }
  assertRecovered(app.root);
  if (args.command === 'doctor') return doctor(app);
  if (args.command !== 'remove' && args.source === undefined) throw new CliError('arguments', `${args.command} requires a moment id or a .choco file.`);
  const moment = args.command === 'remove' ? undefined : await source(args.source!, args);
  const name = args.name ?? moment?.name;
  if (name === undefined || !/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new CliError('arguments', 'Supply --name using a lowercase letter followed by up to 47 lowercase letters, digits or hyphens.');
  const plan = moment === undefined ? planRemove(app, name) : await planAdd(app, name, moment.data, moment.catalog?.url ?? args.catalog, args.command === 'update', { sha256: moment.catalog?.sha256 ?? args['catalog-sha256'], offline: args.offline });
  const summary = { command: args.command, name, target: app.target, changed: plan.changes.map(change => ({ path: change.path, action: change.after === null ? 'remove' : change.before === null ? 'create' : 'update' })), preserved: plan.preserved,
    ...(app.target !== 'react-native' ? {} : { native: { executionVerified: false, nextSteps: ['Run pod install in ios for an iOS application.', 'Rebuild the native application; installing JavaScript dependencies does not link the native view.', 'Android host execution remains a separate verification gate.'] } }),
  };
  if (args['dry-run']) return { ...summary, applied: false };
  if (plan.changes.length > 0) locked(app.root, () => apply(app.root, plan.changes, () => { if (plan.packages) installPackages(app.root, args.offline ?? false); }));
  return { ...summary, applied: true };
}
const json = process.argv.includes('--json');
try {
  const args = options();
  const result = await run(args);
  const unhealthy = 'healthy' in result && result.healthy === false;
  process.stdout.write(json ? `${JSON.stringify({ version: 1, ok: !unhealthy, result })}\n` : report(result));
  if (unhealthy) process.exitCode = 1;
} catch (error) {
  const code = error instanceof CliError ? error.code : 'invalid';
  const message = error instanceof Error ? error.message : String(error);
  if (json) process.stdout.write(`${JSON.stringify({ version: 1, ok: false, error: { code, message } })}\n`);
  else process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
