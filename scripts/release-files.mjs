import { dirname, resolve, basename } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

/** Admit every release attachment before the first publication write. */
export function reviewedReleaseFiles(directory, receipt, version) {
  const expectedPackages = ['@chocopie/codec', '@chocopie/runtime', '@chocopie/react', '@chocopie/cli', '@chocopie/react-native'];
  if (Object.keys(receipt.packages).sort().join(',') !== expectedPackages.sort().join(','))
    throw new Error('The reviewed package family is incomplete or contains an unexpected package.');
  const nativeNames = new Set(['choco-ios-development.zip', 'choco-android-sdk-release.aar', 'SDK-BUILD.json',
    `choco-native-${version}.zip`, 'Package.swift', 'SWIFT-PACKAGE.json']);
  for (const name of Object.keys(receipt.native ?? {})) {
    if (!nativeNames.has(name)) throw new Error(`Unexpected native release attachment: ${name}`);
  }
  if (receipt.catalog?.file !== 'catalog.json') throw new Error('Expected the reviewed release catalog.');
  const artifacts = [...Object.values(receipt.packages), receipt.catalog,
    ...Object.entries(receipt.native ?? {}).map(([file, pin]) => ({ ...pin, file }))];
  const names = [...artifacts.map(pin => pin.file), 'artifacts.json'];
  if (new Set(names).size !== names.length) throw new Error('Release attachment names must be unique.');
  const root = realpathSync(directory);
  const attachments = names.map(name => {
    if (typeof name !== 'string' || basename(name) !== name || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:tgz|zip|aar|json|swift)$/.test(name))
      throw new Error(`Release attachments must use safe flat filenames: ${name}`);
    const path = resolve(directory, name);
    if (!lstatSync(path).isFile() || dirname(realpathSync(path)) !== root)
      throw new Error(`Release attachment must be a confined regular file: ${name}`);
    return path;
  });
  return { artifacts, attachments };
}
