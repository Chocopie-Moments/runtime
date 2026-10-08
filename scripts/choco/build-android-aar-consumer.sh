#!/bin/bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
consumer="$repo/native/android/aar-consumer"
mkdir -p "$consumer/build/staged/assets"
cp "$repo/release/android-sdk/choco-android-sdk-release.aar" "$consumer/build/staged/"
cp "$repo/fixtures/ambient.breathe.choco" "$consumer/build/staged/assets/verification.choco"
bash "$repo/native/android/consumer/android/gradlew" -p "$consumer" --no-daemon --build-cache --max-workers=2 assembleRelease
python3 - "$repo" <<'PY'
import hashlib,json,pathlib,shutil,subprocess,sys
repo=pathlib.Path(sys.argv[1]); apk=repo/'native/android/aar-consumer/build/outputs/apk/release/choco-standalone-aar-proof-release.apk'
output=repo/'release/android-sdk'; shutil.copyfile(apk,output/'standalone-aar-proof-release.apk')
aar=repo/'release/android-sdk/choco-android-sdk-release.aar'
record={'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'applicationId':'com.chocopie.aarproof','minified':True,'reactNativeDependency':False,'executionVerified':False,'apk':{'file':'standalone-aar-proof-release.apk','bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest()},'aarSha256':hashlib.sha256(aar.read_bytes()).hexdigest()}
(output/'AAR-CONSUMER.json').write_text(json.dumps(record,indent=2)+'\n')
PY
