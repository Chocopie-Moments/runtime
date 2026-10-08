#!/bin/bash
# Strict pinned Expo Android Release consumer; compilation does not prove device execution.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
consumer="${CHOCO_EXPO_ANDROID_CONSUMER:?Set a NEW isolated consumer directory}"
tarball="${CHOCO_RN_PACKAGE:?Set the packed Android native artifact}"
python3 - "$repo" "$consumer" <<'PY'
import pathlib,shutil,sys
repo,consumer=map(lambda p:pathlib.Path(p).resolve(),sys.argv[1:]);assert not consumer.exists() and not consumer.is_relative_to(repo)
shutil.copytree(repo/'native/android/expo-consumer',consumer)
shutil.copyfile(repo/'native/react-native/VerificationApp.tsx',consumer/'App.tsx');(consumer/'assets').mkdir()
for src,dst in [('beat.flow.choco','flow.choco'),('beat.drawOn.choco','strokes.choco'),('ambient.pulse.choco','pulse.choco')]:shutil.copyfile(repo/'fixtures'/src,consumer/'assets'/dst)
(consumer/'metro.config.js').write_text("const {getDefaultConfig}=require('expo/metro-config'); const config=getDefaultConfig(__dirname); config.resolver.assetExts=[...new Set([...config.resolver.assetExts,'choco'])]; module.exports=config;\n")
PY
(
 cd "$consumer"
 npm ci --ignore-scripts --no-audit --no-fund
 npm install --ignore-scripts --no-audit --no-fund --save-exact "$tarball"
 npx --offline tsc --noEmit
 CI=1 npx --offline expo prebuild --platform android --no-install
)
bash "$repo/scripts/choco/prepare-android-verification.sh" "$consumer"
(
 cd "$consumer/android"
 export CMAKE_BUILD_PARALLEL_LEVEL="${CHOCO_BUILD_JOBS:-2}"
 bash gradlew --no-daemon --build-cache --max-workers="${CHOCO_BUILD_JOBS:-2}" -PreactNativeArchitectures="${CHOCO_ANDROID_ABIS:-arm64-v8a}" -Dorg.gradle.parallel=false assembleRelease
)
python3 - "$repo" "$consumer" "$tarball" <<'PY'
import pathlib,json,hashlib,shutil,subprocess,sys
repo,consumer,tarball=map(pathlib.Path,sys.argv[1:]);versions={name:json.loads((consumer/'node_modules'/name/'package.json').read_text())['version'] for name in ['expo','react-native','react']}
assert versions=={'expo':'57.0.17','react-native':'0.86.3','react':'19.2.3'}
apk=consumer/'android/app/build/outputs/apk/release/app-release.apk';out=repo/'release/android-expo';out.mkdir(parents=True,exist_ok=True);shutil.copyfile(apk,out/'app-release.apk');shutil.copyfile(consumer/'package-lock.json',out/'consumer-package-lock.json')
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
record={'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'versions':versions,'applicationId':'com.chocopie.expoproof','peerDependencyOverride':False,'executionVerified':False,'physicalDeviceVerified':False,'apk':digest(apk),'nativePackage':digest(tarball),'lockfile':digest(consumer/'package-lock.json')}
(out/'EXPO-CONSUMER.json').write_text(json.dumps(record,indent=2)+'\n')
PY
