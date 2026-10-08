import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { CliError, read } from './files.ts';

const dependencies = z.record(z.string(), z.string());
export const packageSchema = z.object({ name: z.string().optional(), packageManager: z.string().optional(), dependencies: dependencies.optional(), devDependencies: dependencies.optional(), workspaces: z.unknown().optional() }).passthrough();
export function project(path: string) {
  const root = realpathSync(resolve(path));
  for (let parent = dirname(root); parent !== dirname(parent); parent = dirname(parent)) {
    if (!existsSync(join(parent, 'package.json'))) continue;
    const parentPackage = read(parent, 'package.json');
    if (parentPackage !== null && packageSchema.parse(JSON.parse(parentPackage.toString())).workspaces !== undefined)
      throw new CliError('project', 'Workspace installation is not certified yet. Use a standalone application; no workspace files were changed.');
  }
  const content = read(root, 'package.json');
  if (content === null) throw new CliError('project', 'Choose an application folder with package.json using --project.');
  const manifest = packageSchema.parse(JSON.parse(content.toString()));
  const files = readdirSync(root);
  const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter(file => files.includes(file));
  if (locks.length > 1) throw new CliError('project', `Conflicting lockfiles: ${locks.join(', ')}.`);
  if ((manifest.packageManager !== undefined && !manifest.packageManager.startsWith('npm@')) || locks.some(file => file !== 'package-lock.json'))
    throw new CliError('package_manager', 'This development installer is verified with npm. This package manager is not certified yet.');
  if (manifest.workspaces !== undefined) throw new CliError('project', 'Choose a specific application with --project; workspace-root mutation is not supported.');
  const deps = { ...manifest.devDependencies, ...manifest.dependencies };
  const target: 'react-native' | 'react' | 'web' = deps['react-native'] !== undefined || deps.expo !== undefined ? 'react-native' : deps.react !== undefined ? 'react' : 'web';
  return { root, manifest, content, target };
}
export function installPackages(root: string, offline: boolean) {
  const result = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...(offline ? ['--offline'] : [])], { cwd: root, encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) throw new CliError('install_failed', 'Dependency installation did not complete. Files are journaled; run choco recover to finish. Run npm install --ignore-scripts in the project to inspect npm diagnostics.');
}
