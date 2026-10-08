"""Stage reviewed combined native artifacts without publishing them."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import zipfile

release = pathlib.Path('release')
release.mkdir(exist_ok=True)
receipt = json.loads((release / 'artifacts.json').read_text())
source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
assert receipt['source'] == source, 'Native and npm artifacts must use one source revision'

def digest(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def contained(base, relative):
    path = (base / relative).resolve()
    assert path.is_relative_to(base.resolve()), f'Artifact path escapes its root: {relative}'
    return path

sdk = json.loads(pathlib.Path('scripts/generated/choco-ios-package.json').read_text())
assert sdk['source'] == source and sdk['dirty'] is False, 'iOS build must use the same clean release revision'
stage = pathlib.Path(sdk['package'])
archive = release / 'choco-ios-development.zip'
subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(stage), str(archive)], check=True)
rn = json.loads(pathlib.Path('scripts/generated/choco-rn-package.json').read_text())
assert rn['platforms'] == ['ios', 'android'], 'Release staging requires the combined native package'
assert rn['provenance']['source'] == source, 'React Native package source differs from release'
assert rn['provenance']['android']['source'] == source and rn['provenance']['android']['dirty'] is False, 'Android build must use the same clean release revision'
tarball = pathlib.Path(rn['tarball'])
assert digest(tarball) == {key: rn[key] for key in ['bytes', 'sha256']}
shutil.copyfile(tarball, release / tarball.name)
receipt['native'] = {archive.name: digest(archive)}
# SwiftPM remote binary targets require a ZIP containing the XCFramework itself.
versions = {item['version'] for item in receipt['packages'].values()}
assert len(versions) == 1, 'Prepare Swift artifacts from one release family'
version = next(iter(versions))
binary = release / f'choco-native-{version}.zip'
subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(stage / 'Artifacts/ChocoNative.xcframework'), str(binary)], check=True)
url = f'https://github.com/Chocopie-Moments/runtime/releases/download/v{version}/{binary.name}'
checksum = digest(binary)['sha256']
manifest = pathlib.Path('native/ios/Package.swift').read_text()
manifest = manifest.replace('.binaryTarget(name: "ChocoNative", path: "Artifacts/ChocoNative.xcframework")',
                            f'.binaryTarget(name: "ChocoNative", url: "{url}", checksum: "{checksum}")')
manifest = manifest.replace('.target(name: "Choco", dependencies: ["ChocoNative"], linkerSettings:',
                            '.target(name: "Choco", dependencies: ["ChocoNative"], path: "native/ios/Sources/Choco", linkerSettings:')
assert url in manifest and 'path: "native/ios/Sources/Choco"' in manifest
(release / 'Package.swift').write_text(manifest)
swift = {'status': 'prepared-unpublished', 'source': source, 'version': version,
         'binary': {'file': binary.name, 'url': url, **digest(binary)},
         'manifest': {'file': 'Package.swift', **digest(release / 'Package.swift')}}
(release / 'SWIFT-PACKAGE.json').write_text(json.dumps(swift, indent=2) + '\n')
for path in [binary, release / 'Package.swift', release / 'SWIFT-PACKAGE.json']:
    receipt['native'][path.name] = digest(path)

receipt['nativePlatforms'] = rn['platforms']
receipt['packages']['@chocopie-moments/react-native'] = {
    'version': json.loads(pathlib.Path('packages/react-native/package.json').read_text())['version'],
    'file': tarball.name, **digest(release / tarball.name),
}
# Verify the independent AAR contains exactly the JNI slices admitted to the combined RN package.
android = release / 'android-sdk'
android_receipt = json.loads((android / 'SDK-BUILD.json').read_text())
aar = contained(android, android_receipt['file'])
assert digest(aar) == {key: android_receipt[key] for key in ['bytes', 'sha256']}
assert android_receipt['reactNativeDependency'] is False
with zipfile.ZipFile(aar) as packaged:
    assert {name for name in packaged.namelist() if name.startswith('jni/') and name.endswith('/libchoco.so')} == {'jni/' + item['path'] for item in rn['provenance']['android']['artifacts']}
    assert json.loads(packaged.read('assets/chocopie/ANDROID-BUILD.json')) == rn['provenance']['android']
    for artifact in rn['provenance']['android']['artifacts']:
        data = packaged.read('jni/' + artifact['path'])
        assert len(data) == artifact['bytes'] and hashlib.sha256(data).hexdigest() == artifact['sha256']
for path in [aar, android / 'SDK-BUILD.json']:
    shutil.copyfile(path, release / path.name)
    receipt['native'][path.name] = digest(release / path.name)
# Do not upload untracked proof APKs or copies left over from another build.
shutil.rmtree(android)
catalog = json.loads((release / 'catalog.json').read_text())
assert catalog['source'] == source
catalog['packages']['@chocopie-moments/react-native'] = {
    key: receipt['packages']['@chocopie-moments/react-native'][key] for key in ['version', 'file', 'sha256']
}
(release / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
receipt['catalog'] = {'file': 'catalog.json', **digest(release / 'catalog.json')}
(release / 'artifacts.json').write_text(json.dumps(receipt, indent=2) + '\n')
