#!/bin/bash
# Bundle the same reviewed Swift sources and native slices into the private RN artifact.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CHOCO_IOS_PACKAGE:?Set the staged output of build-ios-package.sh}"
android="${CHOCO_ANDROID_PACKAGE:-$PWD/packages/react-native/android}"
platforms="${CHOCO_RN_PLATFORMS:-ios,android}"
stage="$(mktemp -d "${TMPDIR:-/tmp}/choco-react-native.XXXXXX")"
python3 - "$stage" <<'STAGE'
import json,pathlib,shutil,sys
source=pathlib.Path('packages/react-native'); stage=pathlib.Path(sys.argv[1]); manifest=json.loads((source/'package.json').read_text())
# Never copy a development node_modules tree into the package staging directory.
for name in ['package.json',*manifest['files']]:
    if name=='NATIVE-BUILD.json': continue
    item=source/name
    if not item.exists(): continue
    if item.is_dir(): shutil.copytree(item,stage/name,ignore=shutil.ignore_patterns('build','.gradle','local.properties','node_modules'))
    else: shutil.copyfile(item,stage/name)
STAGE
rm -rf "$stage/ios/SDK" "$stage/ios/Artifacts"
mkdir -p "$stage/ios/SDK"
cp "$CHOCO_IOS_PACKAGE/Sources/Choco/ChocoView.swift" "$stage/ios/SDK/"
cp -R "$CHOCO_IOS_PACKAGE/Artifacts" "$stage/ios/"
cp "$CHOCO_IOS_PACKAGE/THORVG-LICENSE" "$stage/"
cp -R "$CHOCO_IOS_PACKAGE/third-party" "$stage/"
python3 - "$stage" "$CHOCO_IOS_PACKAGE" "$android" "$platforms" <<'PROVENANCE'
import hashlib,json,pathlib,shutil,subprocess,sys
stage,ios,android=map(pathlib.Path,sys.argv[1:4]); platforms=sys.argv[4]
assert platforms in ['ios','ios,android'], 'Choose CHOCO_RN_PLATFORMS=ios or ios,android'
def digest(path): return dict(bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
def contained(root,relative):
    path=(root/relative).resolve()
    assert path.is_relative_to(root.resolve()), f'Artifact path escapes package: {relative}'
    return path
ios_build=json.loads((ios/'build.json').read_text())
for name,expected in ios_build['files'].items():
    assert digest(contained(ios,name))==expected, f'iOS artifact changed: {name}'
record={'version':1,'platforms':platforms.split(','),'source':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'ios':ios_build}
if platforms=='ios,android':
    android_build=json.loads((android/'src/main/ANDROID-BUILD.json').read_text())
    assert android_build['artifacts'], 'Android receipt has no compiled ABI artifacts'
    assert android_build['rendererPatches']==json.loads(pathlib.Path('native/renderer/patch.json').read_text()), 'Stale Android renderer patches'
    binaries=android/'src/main/jniLibs'
    for artifact in android_build['artifacts']:
        assert digest(contained(binaries,artifact['path']))=={key:artifact[key] for key in ['bytes','sha256']}, f'Android artifact changed: {artifact["path"]}'
    declared={item['path'] for item in android_build['artifacts']}
    assert declared=={str(path.relative_to(binaries)) for path in binaries.glob('*/libchoco.so')}, 'Android ABI receipt does not cover the package'
    for name,expected in android_build['sources'].items():
        assert digest(contained(pathlib.Path.cwd(),name))['sha256']==expected, f'Android native source changed: {name}'
        if name.endswith('.kt'):
            assert digest(android/'src/main/java/com/chocopie'/pathlib.Path(name).name)['sha256']==expected, f'Staged Android Kotlin source changed: {name}'
    assert android_build.get('notices'), 'Android receipt must include NDK third-party notices'
    for name,expected in android_build['notices'].items():
        assert digest(contained(android/'src/main',name))==expected, f'Android third-party notice changed: {name}'
    if (stage/'android').exists(): shutil.rmtree(stage/'android')
    shutil.copytree(android,stage/'android',ignore=shutil.ignore_patterns('build','.gradle','local.properties','node_modules'))
    record['android']=android_build
else:
    if (stage/'android').exists(): shutil.rmtree(stage/'android')
    # An iOS-only development artifact must not advertise an incomplete Android module.
    (stage/'react-native.config.js').write_text("module.exports = { dependency: { platforms: { android: null } } };\n")
record['files']={str(path.relative_to(stage)):digest(path) for path in stage.rglob('*') if path.is_file()}
(stage/'NATIVE-BUILD.json').write_text(json.dumps(record,indent=2)+'\n')
PROVENANCE
# Use the actual artifact in consumer tests; never install the repo's incomplete source directory.
(cd "$stage" && npm pack --ignore-scripts --json > pack.json)
python3 - "$stage" <<'PY'
import hashlib,json,pathlib,sys
stage=pathlib.Path(sys.argv[1]); tarball=stage/json.loads((stage/'pack.json').read_text())[0]['filename']
native=json.loads((stage/'NATIVE-BUILD.json').read_text())
record=dict(stage=str(stage),tarball=str(tarball),bytes=tarball.stat().st_size,sha256=hashlib.sha256(tarball.read_bytes()).hexdigest(),platforms=native['platforms'],provenance=native)
pathlib.Path('scripts/generated').mkdir(parents=True,exist_ok=True)
pathlib.Path('scripts/generated/choco-rn-package.json').write_text(json.dumps(record,indent=2)+'\n')
print(tarball)
PY
