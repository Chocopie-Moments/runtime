import { decodeChoco } from '../../../src/codec/codec.ts';
import { catalog, compatible } from './catalog.ts';
import { bytes, CliError, digest, read, same } from './files.ts';
import type { Change } from './files.ts';
import { project } from './project.ts';
import { installedAssets, ownedFiles, receipt, RECEIPT } from './receipt.ts';
import type { Receipt } from './receipt.ts';
import { usage } from './usage.ts';
import { admitNative, metro } from './metro.ts';

/** dependencies are the catalog packages the plan pins, each checked against its catalog hash. */
export type Plan = { changes: Change[]; packages: boolean; preserved: string[]; dependencies?: { name: string; version: string }[] };
const json = (value: unknown) => bytes(`${JSON.stringify(value, null, 2)}\n`);
function changes(root: string, snapshot: ReadonlyMap<string, Buffer | null>) {
  const entries = new Map<string, Change>();
  return {
    put(path: string, after: Buffer | null) { entries.set(path, { path, before: snapshot.has(path) ? snapshot.get(path)! : read(root, path), after }); },
    all() { return [...entries.values()].filter(change => !same(change.before, change.after)); },
  };
}
function snapshot(app: ReturnType<typeof project>) {
  const data = read(app.root, RECEIPT);
  const installed = receipt(app.root, data);
  const before = new Map<string, Buffer | null>([['package.json', app.content], [RECEIPT, data]]);
  if (installed.metro !== undefined) {
    const value = read(app.root, installed.metro.path);
    if (value === null || digest(value) !== installed.metro.sha256) throw new CliError('conflict', `Metro configuration changed: ${installed.metro.path}. Your edit was preserved.`);
    before.set(installed.metro.path, value);
  }
  for (const item of installed.installations) for (const [path, hash] of Object.entries(item.files)) {
    const value = read(app.root, path);
    if (value === null || digest(value) !== hash) throw new CliError('conflict', `Generated file changed: ${path}. Your edit was preserved.`);
    before.set(path, value);
  }
  for (const dependency of Object.values(installed.dependencies)) before.set(dependency.artifact, read(app.root, dependency.artifact));
  return { installed, before };
}
function validateDependencies(app: ReturnType<typeof project>, installed: Receipt) {
  for (const [name, dependency] of Object.entries(installed.dependencies)) {
    if (app.manifest.dependencies?.[name] !== dependency.value) throw new CliError('conflict', `Dependency changed: ${name}. Restore the installed pin before updating.`);
    const artifact = read(app.root, dependency.artifact);
    if (artifact === null || digest(artifact) !== dependency.sha256) throw new CliError('integrity', `Installed package artifact changed: ${name}.`);
  }
}
export async function planAdd(app: ReturnType<typeof project>, name: string, asset: Uint8Array, releaseFile: string | undefined, update: boolean, catalogOptions: { sha256?: string; offline?: boolean } = {}): Promise<Plan> {
  if (app.target === 'react-native') admitNative(app);
  const { installed, before } = snapshot(app);
  validateDependencies(app, installed);
  const existing = installed.installations.find(item => item.name === name);
  if (update && existing === undefined) throw new CliError('missing', `No installation named ${name}. Use choco add.`);
  if (!update && existing !== undefined && existing.sha256 !== digest(asset)) throw new CliError('exists', `An asset named ${name} is already installed. Use choco update.`);
  const decoded = await decodeChoco(asset);
  const requirements = await installedAssets(app.root, installed);
  const release = await catalog(releaseFile, catalogOptions);
  const requiredPackages = new Set(installed.installations.filter(item => item.name !== name).flatMap(item => item.target === 'react-native' ? ['@chocopie-moments/react-native'] : item.target === 'react' ? ['@chocopie-moments/runtime', '@chocopie-moments/react'] : ['@chocopie-moments/runtime']));
  for (const dependency of app.target === 'react-native' ? ['@chocopie-moments/react-native'] : app.target === 'react' ? ['@chocopie-moments/runtime', '@chocopie-moments/react'] : ['@chocopie-moments/runtime']) requiredPackages.add(dependency);
  for (const dependency of requiredPackages) if (!release.packages.some(pkg => pkg.name === dependency))
    throw new CliError('catalog', `The release catalog is missing ${dependency}. Supply the complete tested package artifacts.`);
  compatible(release, [...requirements.filter((_, index) => installed.installations[index].name !== name), decoded.manifest]);
  const planned = changes(app.root, before);
  const assetPath = `assets/choco/${name}.choco`;
  const wrapperPath = `src/choco/${name}.${app.target === 'web' ? 'ts' : 'tsx'}`;
  // Manifest states also include event clips; only named states belong in setState's type.
  const states = [...new Set(['idle', ...Object.keys(decoded.document.motion.score.states ?? {})])].sort();
  const generated = new Map([[assetPath, Buffer.from(asset)], [wrapperPath, bytes(usage(name, app.target, states))]]);
  for (const [path, content] of generated) {
    if (existing?.files[path] === undefined && read(app.root, path) !== null) throw new CliError('conflict', `File already exists: ${path}. Choose another --name.`);
    planned.put(path, content);
  }
  if (existing !== undefined) for (const path of Object.keys(existing.files)) if (!generated.has(path)) planned.put(path, null);
  installed.installations = installed.installations.filter(item => item.name !== name);
  installed.installations.push({ name, asset: assetPath, sha256: digest(asset), target: app.target, files: Object.fromEntries([...generated].map(([path, content]) => [path, digest(content)])) });
  installed.installations.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (app.target === 'react-native') {
    const change = metro(app, installed);
    if (change !== null) planned.put(change.path, change.after);
  }
  app.manifest.dependencies ??= {};
  for (const pkg of release.packages) {
    if (!requiredPackages.has(pkg.name)) continue;
    if (app.manifest.devDependencies?.[pkg.name] !== undefined) throw new CliError('conflict', `${pkg.name} is in devDependencies. Move it to dependencies before installing.`);
    const prior = installed.dependencies[pkg.name];
    const value = `file:./${pkg.path}`;
    installed.dependencies[pkg.name] = { value, version: pkg.version, previous: prior === undefined ? app.manifest.dependencies[pkg.name] ?? null : prior.previous, artifact: pkg.path, sha256: digest(pkg.data) };
    app.manifest.dependencies[pkg.name] = value;
    const current = read(app.root, pkg.path);
    if (current !== null && !same(current, pkg.data)) throw new CliError('integrity', `Package path was changed: ${pkg.path}.`);
    planned.put(pkg.path, pkg.data);
    if (prior !== undefined && prior.artifact !== pkg.path) planned.put(prior.artifact, null);
  }
  planned.put('package.json', json(app.manifest));
  planned.put(RECEIPT, json(installed));
  const result = planned.all();
  const dependencies = release.packages.filter(pkg => requiredPackages.has(pkg.name)).map(({ name, version }) => ({ name, version }));
  return { changes: result, packages: result.some(change => change.path === 'package.json'), preserved: [], dependencies };
}
export function planRemove(app: ReturnType<typeof project>, name: string): Plan {
  const data = read(app.root, RECEIPT);
  const installed = receipt(app.root, data);
  const item = installed.installations.find(entry => entry.name === name);
  if (item === undefined) throw new CliError('missing', `No installation named ${name}.`);
  const before = new Map([['package.json', app.content], [RECEIPT, data]]);
  const planned = changes(app.root, before);
  const preserved: string[] = [];
  for (const [path, hash] of Object.entries(item.files)) {
    const value = read(app.root, path);
    before.set(path, value);
    if (value !== null && digest(value) === hash) planned.put(path, null); else preserved.push(path);
  }
  installed.installations = installed.installations.filter(entry => entry.name !== name);
  if (installed.metro !== undefined && !installed.installations.some(entry => entry.target === 'react-native')) {
    const current = read(app.root, installed.metro.path);
    before.set(installed.metro.path, current);
    if (current !== null && digest(current) === installed.metro.sha256) {
      planned.put(installed.metro.path, installed.metro.previous === null ? null : Buffer.from(installed.metro.previous, 'base64'));
      delete installed.metro;
    } else preserved.push(installed.metro.path);
  }
  for (const [name, dependency] of Object.entries(installed.dependencies)) {
    const needed = installed.installations.some(entry => name === '@chocopie-moments/react-native' ? entry.target === 'react-native' : name === '@chocopie-moments/react' ? entry.target === 'react' : entry.target !== 'react-native');
    if (needed) continue;
    if (app.manifest.dependencies?.[name] !== dependency.value || preserved.length > 0) { preserved.push(`dependency:${name}`); continue; }
    if (dependency.previous === null) delete app.manifest.dependencies[name]; else app.manifest.dependencies[name] = dependency.previous;
    const artifact = read(app.root, dependency.artifact);
    before.set(dependency.artifact, artifact);
    if (artifact !== null && digest(artifact) === dependency.sha256) planned.put(dependency.artifact, null); else preserved.push(dependency.artifact);
    delete installed.dependencies[name];
  }
  planned.put('package.json', json(app.manifest));
  planned.put(RECEIPT, json(installed));
  const result = planned.all();
  return { changes: result, packages: result.some(change => change.path === 'package.json'), preserved };
}
export async function doctor(app: ReturnType<typeof project>) {
  const installed = receipt(app.root);
  validateDependencies(app, installed);
  await installedAssets(app.root, installed);
  const files = ownedFiles(app.root, installed);
  const problems = files.filter(file => !file.matches).map(file => `Changed or missing: ${file.path}`);
  if (installed.metro !== undefined) {
    const configuration = read(app.root, installed.metro.path);
    if (configuration === null || digest(configuration) !== installed.metro.sha256) problems.push(`Changed or missing: ${installed.metro.path}`);
  }
  for (const [name, dependency] of Object.entries(installed.dependencies)) {
    const value = read(app.root, `node_modules/${name}/package.json`);
    if (value === null || JSON.parse(value.toString()).version !== dependency.version) problems.push(`Run npm install --ignore-scripts to restore ${name}@${dependency.version}.`);
  }
  return { healthy: problems.length === 0, installations: installed.installations.map(item => ({ name: item.name, sha256: item.sha256, target: item.target })), problems };
}
