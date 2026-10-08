import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { encodeChoco, validateChocoDocument } from '../../../src/codec/codec.ts';
import { apply, digest, read, write, bytes } from './files.ts';
import { planAdd, planRemove } from './plan.ts';
import { project } from './project.ts';
import { receipt } from './receipt.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function consumer() {
  const root = mkdtempSync(join(tmpdir(), 'choco-native-plan-')); roots.push(root);
  write(root, 'package.json', bytes(JSON.stringify({ name: 'native-consumer', dependencies: { react: '19.2.3', 'react-native': '0.87.1' } })));
  for (const [name, version] of [['react', '19.2.3'], ['react-native', '0.87.1']]) {
    mkdirSync(join(root, 'node_modules', name), { recursive: true });
    writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ version }));
  }
  const original = "module.exports = { transformer: { custom: true }, resolver: { assetExts: ['png'], sourceExts: ['ts', 'tsx'] } };\n";
  write(root, 'metro.config.js', bytes(original));
  const native = bytes('hashed-native-package');
  write(root, 'native.tgz', native);
  write(root, 'catalog.json', bytes(JSON.stringify({ version: 1, format: 0, semantics: 1, capabilities: [], packages: {
    '@chocopie/react-native': { version: '0.1.0-dev.0', file: 'native.tgz', sha256: digest(native) },
  } })));
  const document = validateChocoDocument({ name: 'Still', kind: 'success', palette: { accent: '#ff0000', secondary: '#00ff00', ink: '#000000', background: '#ffffff' },
    scene: { viewBox: [0, 0, 32, 32], root: { transform: [1, 0, 0, 1, 0, 0], opacity: 1, displayed: true, visible: true, children: [] } },
    motion: { kind: 'score', rig: { width: 32, height: 32, parts: [] }, score: {} },
  });
  const asset = await encodeChoco(document);
  // Capability requirements are taken from the real admitted compiled asset.
  const { decodeChoco } = await import('../../../src/codec/codec.ts');
  const catalog = JSON.parse(read(root, 'catalog.json')!.toString());
  catalog.capabilities = (await decodeChoco(asset)).manifest.required;
  write(root, 'catalog.json', bytes(JSON.stringify(catalog)));
  return { root, original, asset, catalog: join(root, 'catalog.json') };
}

describe('native installation planning', () => {
  it('copies exact assets, pins native only, preserves Metro settings, and restores them on removal', async () => {
    const app = await consumer();
    const plan = await planAdd(project(app.root), 'moment', app.asset, app.catalog, false);
    apply(app.root, plan.changes, () => {});
    expect(read(app.root, 'assets/choco/moment.choco')).toEqual(Buffer.from(app.asset));
    const installed = receipt(app.root);
    expect(Object.keys(installed.dependencies)).toEqual(['@chocopie/react-native']);
    expect(installed.installations[0].target).toBe('react-native');
    const generated = read(app.root, 'src/choco/moment.tsx')!.toString();
    expect(generated).toContain("require('../../assets/choco/moment.choco')");
    expect(generated).toContain("Omit<ChocoProps, 'source' | 'state'>");
    const context = { module: { exports: {} } };
    runInNewContext(read(app.root, 'metro.config.js')!.toString(), context);
    expect(context.module.exports).toEqual({ transformer: { custom: true }, resolver: { assetExts: ['png', 'choco'], sourceExts: ['ts', 'tsx'] } });
    expect((await planAdd(project(app.root), 'moment', app.asset, app.catalog, false)).changes).toEqual([]);
    const removal = planRemove(project(app.root), 'moment');
    apply(app.root, removal.changes, () => {});
    expect(read(app.root, 'metro.config.js')!.toString()).toBe(app.original);
    expect(read(app.root, 'assets/choco/moment.choco')).toBeNull();
    expect(receipt(app.root).dependencies).toEqual({});
  });

  it('admits only the verified Expo iOS profile and creates the Expo Metro default', async () => {
    const app = await consumer();
    const manifest = JSON.parse(read(app.root, 'package.json')!.toString());
    manifest.dependencies.expo = '57.0.17';
    manifest.dependencies['react-native'] = '0.86.3';
    write(app.root, 'package.json', bytes(JSON.stringify(manifest)));
    mkdirSync(join(app.root, 'node_modules/expo'), { recursive: true });
    write(app.root, 'node_modules/expo/package.json', bytes(JSON.stringify({ version: '57.0.17' })));
    write(app.root, 'node_modules/react-native/package.json', bytes(JSON.stringify({ version: '0.86.3' })));
    write(app.root, 'metro.config.js', null);
    const plan = await planAdd(project(app.root), 'moment', app.asset, app.catalog, false);
    const config = plan.changes.find(change => change.path === 'metro.config.js')!.after!.toString();
    expect(config).toContain("require('expo/metro-config')");
    const context = { module: { exports: {} }, __dirname: app.root, require: (name: string) => {
      expect(name).toBe('expo/metro-config');
      return { getDefaultConfig: () => ({ resolver: { assetExts: ['png'] } }) };
    } };
    runInNewContext(config, context);
    expect(context.module.exports).toEqual({ resolver: { assetExts: ['png', 'choco'] } });
    write(app.root, 'node_modules/expo/package.json', bytes(JSON.stringify({ version: '57.0.18' })));
    await expect(planAdd(project(app.root), 'moment', app.asset, app.catalog, false)).rejects.toThrow('verified Expo iOS profile');
  });

  it('preserves later Metro edits and refuses unverified Expo admission', async () => {
    const app = await consumer();
    apply(app.root, (await planAdd(project(app.root), 'moment', app.asset, app.catalog, false)).changes, () => {});
    write(app.root, 'metro.config.js', bytes('// App owner edit\n'));
    await expect(planAdd(project(app.root), 'moment', app.asset, app.catalog, true)).rejects.toThrow('Metro configuration changed');
    const removal = planRemove(project(app.root), 'moment');
    expect(removal.preserved).toContain('metro.config.js');
    apply(app.root, removal.changes, () => {});
    expect(read(app.root, 'metro.config.js')!.toString()).toBe('// App owner edit\n');
    const manifest = JSON.parse(read(app.root, 'package.json')!.toString());
    manifest.dependencies.expo = '56.0.0';
    write(app.root, 'package.json', bytes(JSON.stringify(manifest)));
    await expect(planAdd(project(app.root), 'moment', app.asset, app.catalog, false)).rejects.toThrow('verified Expo iOS profile');
  });
});
