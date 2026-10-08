#!/bin/bash
# Source-only preparation; build/install/device execution is deliberately separate.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
consumer="${1:?Pass an existing clean React Native consumer path}"
fixture="${2:-$repo/fixtures/ambient.breathe.choco}"
mkdir -p "$consumer/android/app/src/main/java/com/chocopie/verification" "$consumer/android/app/src/main/assets"
cp "$repo/native/android/verification/ChocoVerificationActivity.kt" "$consumer/android/app/src/main/java/com/chocopie/verification/"
cp "$repo/native/android/verification/ChocoVerification.kt" "$consumer/android/app/src/main/java/com/chocopie/verification/"
cp "$fixture" "$consumer/android/app/src/main/assets/verification.choco"
python3 - "$consumer/android/app/src/main/AndroidManifest.xml" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text(); name='com.chocopie.verification.ChocoVerificationActivity'
if name not in s: s=s.replace('</application>',f'<activity android:name="{name}" android:exported="true" />\n    </application>'); p.write_text(s)
PY
printf 'Prepared native verification Activity in %s; build Release before running adb shell am start -n <applicationId>/com.chocopie.verification.ChocoVerificationActivity\n' "$consumer"
