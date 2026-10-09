/** Plain-text output for a person at a terminal. --json keeps the machine-readable result. */
type Change = { path: string; action: string };
type Target = 'web' | 'react' | 'react-native';
type Installed = {
  command: string; name: string; target: Target; id?: string; declined?: boolean;
  changed: Change[]; preserved: string[]; applied: boolean; native?: { nextSteps: string[] };
};
type Decoded = { document: { name: string; kind: string }; manifest: { states: readonly string[] } };
export type PlanInfo = { moment?: Decoded; app?: string; project: string; dependencies: { name: string; version: string }[]; asset?: number };

const lines = (items: readonly string[]) => items.map(item => `  ${item}\n`).join('');
const PLATFORM: Record<Target, string> = { web: 'plain web', react: 'React', 'react-native': 'React Native' };
const PAST: Record<string, string> = { add: 'Added', update: 'Updated', remove: 'Removed' };
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const CLI = 'npx @chocopie-moments/cli';

/** What a change is about to do, before the question: the moment, the project and every file. */
export function planned(result: Installed, info: PlanInfo) {
  const rows: string[] = [];
  if (info.moment !== undefined) {
    const states = info.moment.manifest.states.filter(state => !['enter', 'hover', 'click'].includes(state));
    rows.push(`Moment   ${info.moment.document.name} (${info.moment.document.kind})${info.app === undefined ? '' : ` from ${info.app}`}`);
    rows.push(`States   ${states.join(', ')}`);
  }
  rows.push(`Project  ${info.project} · ${PLATFORM[result.target]} · npm`);
  const files = result.changed.filter(change => !change.path.startsWith('.choco/'));
  const width = Math.max(...files.map(change => change.path.length));
  const out = [`${rows.join('\n')}\n`, `\n${result.command === 'remove' ? 'Changes' : 'Files'}\n`];
  out.push(lines(files.map(change => {
    const checked = change.path.endsWith('.choco') && info.asset !== undefined ? `  ${kb(info.asset)}  checked` : '';
    return `${change.action.padEnd(6)} ${change.path.padEnd(width)}${checked}`;
  })));
  if (info.dependencies.length > 0 && result.command !== 'remove')
    out.push(`Packages\n${lines(info.dependencies.map(item => `${item.name}@${item.version}  checked`))}`);
  return `${out.join('')}\n`;
}

function usage({ name, target }: Installed) {
  if (target === 'web') return [`import { mount } from './choco/${name}';`, 'const player = await mount(container);  // player.destroy() when it is removed'];
  return [`import { Moment } from './choco/${name}';`, '<Moment style={{ width: 240, height: 240 }} />'];
}

function installed(result: Installed) {
  const kept = result.preserved.length === 0 ? '' : `Kept because you edited them:\n${lines(result.preserved)}`;
  if (result.declined) return 'Nothing was changed.\n';
  if (!result.applied) {
    const changes = lines(result.changed.map(change => `${change.action.padEnd(6)} ${change.path}`));
    return `${result.changed.length === 0 ? `${result.name} is already up to date.\n` : `Would ${result.command} ${result.name}:\n${changes}`}${kept}Nothing was changed. Run the same command without --dry-run to apply it.\n`;
  }
  const head = result.changed.length === 0 ? `${result.name} is already up to date.\n` : `${PAST[result.command]} ${result.name}.\n`;
  if (result.command === 'remove') return `${head}${kept}`;
  const from = `in a file under src/, such as src/App.tsx`;
  return [
    head, kept,
    `\nShow it ${from}:\n${lines(usage(result))}`,
    ...(result.native === undefined ? [] : [`\nThen:\n${lines(result.native.nextSteps)}`]),
    `\nUpdate it   ${CLI} update ${result.id ?? `<file.choco> --name ${result.name}`}\n`,
    `Remove it   ${CLI} remove --name ${result.name}\n`,
  ].join('');
}

export function report(result: object): string {
  if ('help' in result) return `${String(result.help)}\n`;
  if ('applied' in result) return installed(result as Installed);
  if ('healthy' in result) {
    const { healthy, installations, problems } = result as { healthy: boolean; installations: { name: string }[]; problems: string[] };
    if (!healthy) return `Needs attention:\n${lines(problems)}`;
    return installations.length === 0 ? 'No moments are installed here.\n' : `Healthy:\n${lines(installations.map(item => item.name))}`;
  }
  if ('recovery' in result) {
    const recovery = (result as { recovery: 'none' | 'restored' | 'completed' }).recovery;
    return { none: 'Nothing to recover.\n', restored: 'Undid the interrupted install.\n', completed: 'Finished the interrupted install.\n' }[recovery];
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}
