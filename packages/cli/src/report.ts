/** Plain-text output for a person at a terminal. --json keeps the machine-readable result. */
type Change = { path: string; action: string };
type Installed = {
  command: string; name: string; target: 'web' | 'react' | 'react-native';
  changed: Change[]; preserved: string[]; applied: boolean; native?: { nextSteps: string[] };
};

const lines = (items: readonly string[]) => items.map(item => `  ${item}\n`).join('');
const PAST: Record<string, string> = { add: 'Added', update: 'Updated', remove: 'Removed' };

function usage({ name, target }: Installed) {
  const file = `src/choco/${name}.${target === 'web' ? 'ts' : 'tsx'}`;
  return target === 'web'
    ? `Show it on a screen: import { mount } from ${file}, await mount(container), and destroy the returned player when the container is removed.\n`
    : `Show it on a screen: import { Moment } from ${file} and render <Moment style={{ width: 240, height: 240 }} />.\n`;
}

function installed(result: Installed) {
  const changes = lines(result.changed.map(change => `${change.action.padEnd(6)} ${change.path}`));
  const kept = result.preserved.length === 0 ? '' : `Kept because you edited them:\n${lines(result.preserved)}`;
  if (!result.applied)
    return `${result.changed.length === 0 ? `${result.name} is already up to date.\n` : `Would ${result.command} ${result.name}:\n${changes}`}${kept}Nothing was changed. Run the same command without --dry-run to apply it.\n`;
  if (result.changed.length === 0) return `${result.name} is already up to date. Nothing changed.\n${kept}`;
  const next = result.command === 'remove' ? '' : `${usage(result)}${result.native === undefined ? '' : lines(result.native.nextSteps)}`;
  return `${PAST[result.command]} ${result.name}.\n${changes}${kept}${next}`;
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
