#!/bin/bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
# Reuse the independently compiled/attested JNI slices; never rebuild or fetch a renderer here.
staged="${CHOCO_ANDROID_STAGE:-$repo/packages/react-native/android/src/main}"
python3 - "$repo" "$staged" <<'PY'
import hashlib,json,pathlib,shutil,sys
repo=pathlib.Path(sys.argv[1]); staged=pathlib.Path(sys.argv[2]); receipt=json.loads((staged/'ANDROID-BUILD.json').read_text())
assert receipt['api']==24, 'Review SDK minimum API before changing it'
for name,digest in receipt['sources'].items():
 assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==digest, f'Stale native input: {name}'
for artifact in receipt['artifacts']:
 path=staged/'jniLibs'/artifact['path']
 assert path.stat().st_size==artifact['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest()==artifact['sha256'], f'Unverified JNI artifact: {path}'
for name,record in receipt['notices'].items():
 path=staged/name
 assert path.stat().st_size==record['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest()==record['sha256'], f'Unverified notice: {path}'
output=repo/'native/android/sdk/build/staged'
if output.exists(): shutil.rmtree(output)
shutil.copytree(staged/'jniLibs',output/'jniLibs')
assets=output/'assets'/'chocopie'; assets.mkdir(parents=True)
shutil.copyfile(staged/'ANDROID-BUILD.json',assets/'ANDROID-BUILD.json')
shutil.copytree(staged/'third-party',assets/'third-party')
for name in ['LICENSE','NOTICE']: shutil.copyfile(repo/name,assets/name)
shutil.copyfile(repo/'third-party/ThorVG-LICENSE',assets/'THORVG-LICENSE')
PY
bash "$repo/native/android/consumer/android/gradlew" -p "$repo/native/android/sdk" --no-daemon --build-cache --max-workers=2 assembleRelease
python3 - "$repo" <<'PY'
import hashlib,json,pathlib,shutil,sys,zipfile
repo=pathlib.Path(sys.argv[1]); aar=repo/'native/android/sdk/build/outputs/aar/choco-android-sdk-release.aar'
with zipfile.ZipFile(aar) as archive:
 names=archive.namelist()
 assert 'classes.jar' in names and any(name.startswith('jni/') and name.endswith('/libchoco.so') for name in names)
 assert not any('reactnative' in name.lower() or 'facebook' in name.lower() for name in names)
output=repo/'release/android-sdk'; output.mkdir(parents=True,exist_ok=True)
shutil.copyfile(aar,output/aar.name)
record={'status':'development-unreleased','file':aar.name,'bytes':aar.stat().st_size,'sha256':hashlib.sha256(aar.read_bytes()).hexdigest(),'agp':'9.2.1','kotlin':'2.2.0','gradle':'9.4.1','compileSdk':37,'minSdk':24,'reactNativeDependency':False}
(output/'SDK-BUILD.json').write_text(json.dumps(record,indent=2)+'\n')
PY
