import { CliError, bytes, digest, read } from './files.ts';
import type { Receipt } from './receipt.ts';
import type { project } from './project.ts';

/** Append one reversible resolver extension; the application's original configuration stays intact. */
export function metro(app: ReturnType<typeof project>, installed: Receipt) {
  if (installed.metro !== undefined) {
    const current = read(app.root, installed.metro.path);
    if (current === null || digest(current) !== installed.metro.sha256)
      throw new CliError('conflict', `Metro configuration changed: ${installed.metro.path}. Your edit was preserved.`);
    return null;
  }
  const candidates = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].filter(path => read(app.root, path) !== null);
  if (candidates.length > 1 || candidates.some(path => path.endsWith('.mjs') || path.endsWith('.ts')))
    throw new CliError('metro', 'Use one CommonJS metro.config.cjs or metro.config.js. ESM and TypeScript Metro configuration are not supported by this installer.');
  const path = candidates[0] ?? (app.manifest.type === 'module' ? 'metro.config.cjs' : 'metro.config.js');
  if (path.endsWith('.js') && app.manifest.type === 'module')
    throw new CliError('metro', 'Rename the CommonJS Metro configuration to metro.config.cjs before installing in an ESM project.');
  const previous = read(app.root, path);
  const expo = app.manifest.dependencies?.expo !== undefined || app.manifest.devDependencies?.expo !== undefined;
  const metroPackage = expo ? 'expo/metro-config' : '@react-native/metro-config';
  const original = previous?.toString('utf8') ?? `module.exports = require('${metroPackage}').getDefaultConfig(__dirname);\n`;
  if (previous !== null && (!/\bmodule\.exports\s*=/.test(original) || /\b(?:export|import)\s/.test(original)))
    throw new CliError('metro', 'The Metro configuration must export a CommonJS object, function, or promise. Convert it before installing; its contents were preserved.');
  const after = bytes(`${original}\n// Choco bundled assets. Removed when the last installed native moment is removed.\n{\n  const originalChocoConfig = module.exports;\n  const extendChocoConfig = config => {\n    if (!config || typeof config !== 'object') throw new Error('Choco requires a Metro configuration object.');\n    const resolver = config.resolver || {};\n    if (!Array.isArray(resolver.assetExts)) throw new Error('Choco requires Metro resolver.assetExts.');\n    return { ...config, resolver: { ...resolver, assetExts: [...new Set([...resolver.assetExts, 'choco'])] } };\n  };\n  module.exports = typeof originalChocoConfig === 'function'\n    ? (...args) => { const config = originalChocoConfig(...args); return config && typeof config.then === 'function' ? config.then(extendChocoConfig) : extendChocoConfig(config); }\n    : originalChocoConfig && typeof originalChocoConfig.then === 'function' ? originalChocoConfig.then(extendChocoConfig) : extendChocoConfig(originalChocoConfig);\n}\n`);
  installed.metro = { path, previous: previous?.toString('base64') ?? null, sha256: digest(after) };
  return { path, before: previous, after };
}

/** Development admission stays explicit until the matching native consumer is exercised. */
export function admitNative(app: ReturnType<typeof project>) {
  const expoDeclared = app.manifest.dependencies?.expo !== undefined || app.manifest.devDependencies?.expo !== undefined;
  const expo = read(app.root, 'node_modules/expo/package.json');
  const rn = read(app.root, 'node_modules/react-native/package.json');
  const react = read(app.root, 'node_modules/react/package.json');
  const rnVersion = rn === null ? null : JSON.parse(rn.toString()).version;
  const reactVersion = react === null ? null : JSON.parse(react.toString()).version;
  if (expoDeclared) {
    if (expo === null || JSON.parse(expo.toString()).version !== '57.0.17' || rnVersion !== '0.86.3' || reactVersion !== '19.2.3')
      throw new CliError('platform', 'The verified Expo iOS profile requires Expo 57.0.17, React Native 0.86.3 and React 19.2.3. Other Expo profiles and Android remain unverified.');
    return;
  }
  if (rnVersion !== '0.87.1' || typeof reactVersion !== 'string' || !/^19\.2\./.test(reactVersion))
    throw new CliError('platform', 'Install React Native 0.87.1 and React 19.2.x in the standalone application before adding a native moment.');
}
