#!/bin/bash
# Runs an already installed proof APK; does not build, boot or install anything.
set -euo pipefail
app="${CHOCO_ANDROID_APPLICATION_ID:-com.chocornproof}"
output="${1:?Pass a local evidence directory}"
mkdir -p "$output"
adb_args=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then adb_args=(-s "$ANDROID_SERIAL"); fi
adb "${adb_args[@]}" shell rm -f "/sdcard/Android/data/$app/files/choco-verification.json"
adb "${adb_args[@]}" shell am start -W -n "$app/com.chocopie.verification.ChocoVerificationActivity"
for attempt in $(seq 1 30); do
  if adb "${adb_args[@]}" shell cat "/sdcard/Android/data/$app/files/choco-verification.json" > "$output/result.json" 2>/dev/null; then break; fi
  sleep 1
done
python3 - "$output/result.json" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]); result=json.loads(p.read_text()); print(json.dumps(result,indent=2)); assert result['status']=='passed', 'Android native verification failed'
PY
for file in choco-android-frame.png choco-android-frame.rgba choco-android-frame.premultiplied.rgba choco-android-frame.json choco-fixture.sha256; do
  adb "${adb_args[@]}" pull "/sdcard/Android/data/$app/files/$file" "$output/$file"
done
adb "${adb_args[@]}" shell getprop > "$output/device-properties.txt"
adb "${adb_args[@]}" logcat -d -s ChocoVerification:V AndroidRuntime:E > "$output/logcat.txt"
