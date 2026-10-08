#!/bin/bash
# Build an isolated, locked RN 0.87.1 Fabric Release consumer from the Android-only tarball.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
consumer="${CHOCO_ANDROID_CONSUMER:?Set a new isolated consumer directory outside this checkout}"
tarball="${CHOCO_RN_PACKAGE:?Set packed Android proof tarball}"
jobs="${CHOCO_BUILD_JOBS:-2}"
python3 - "$repo" "$consumer" <<'PY'
import pathlib,shutil,sys
repo,consumer=map(lambda p:pathlib.Path(p).resolve(),sys.argv[1:]);assert consumer!=repo and not consumer.is_relative_to(repo);assert not consumer.exists(),'Use a new empty consumer path'
shutil.copytree(repo/'native/android/consumer',consumer)
shutil.copyfile(repo/'native/react-native/VerificationApp.tsx',consumer/'App.tsx');(consumer/'assets').mkdir(exist_ok=True)
for src,dst in [('beat.flow.choco','flow.choco'),('beat.drawOn.choco','strokes.choco'),('ambient.pulse.choco','pulse.choco')]:shutil.copyfile(repo/'fixtures'/src,consumer/'assets'/dst)
(consumer/'metro.config.js').write_text("const {getDefaultConfig}=require('@react-native/metro-config'); const config=getDefaultConfig(__dirname); config.resolver.assetExts=[...new Set([...config.resolver.assetExts,'choco'])]; module.exports=config;\n")
PY
bash "$repo/scripts/choco/prepare-android-verification.sh" "$consumer"
(
 cd "$consumer"
 npm ci --ignore-scripts --no-audit --no-fund
 npm install --ignore-scripts --no-audit --no-fund --save-exact "$tarball"
 npx --offline tsc --noEmit
 # Standard template test key only; generated outside source and never used for publication.
 keytool -genkeypair -keystore android/app/debug.keystore -storepass android -alias androiddebugkey -keypass android -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
 chmod +x android/gradlew
 cd android
 export CMAKE_BUILD_PARALLEL_LEVEL="$jobs"
 ./gradlew --no-daemon --build-cache --max-workers="$jobs" -PreactNativeArchitectures="${CHOCO_ANDROID_ABIS:-arm64-v8a}" -Dorg.gradle.parallel=false assembleRelease
)
python3 - "$repo" "$consumer" "$tarball" "$jobs" <<'PY'
import pathlib,hashlib,json,subprocess,sys
repo,consumer,tarball=map(pathlib.Path,sys.argv[1:4]);jobs=int(sys.argv[4]);apk=consumer/'android/app/build/outputs/apk/release/app-release.apk';assert apk.is_file()
def digest(p):return dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
record=dict(source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),configuration='Release',buildJobs=jobs,reactNative=json.loads((consumer/'node_modules/react-native/package.json').read_text())['version'],apk=dict(path=str(apk),**digest(apk)),nativePackage=dict(path=str(tarball),**digest(tarball)),lockfile=digest(consumer/'package-lock.json'),executionVerified=False,physicalDeviceVerified=False)
assert record['reactNative']=='0.87.1';(repo/'scripts/generated/choco-android-consumer.json').write_text(json.dumps(record,indent=2)+'\n');print(apk)
PY
