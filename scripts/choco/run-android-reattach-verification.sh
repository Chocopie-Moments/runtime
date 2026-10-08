#!/bin/bash
# Uses an installed proof APK and adb-owned OS settings; no app permission or build.
set -euo pipefail
app="${CHOCO_ANDROID_APPLICATION_ID:-com.chocornproof}"
output="${1:?Pass a local evidence directory}"
mkdir -p "$output"
adb_args=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then adb_args=(-s "$ANDROID_SERIAL"); fi
original="$(adb "${adb_args[@]}" shell settings get global animator_duration_scale | tr -d '\r')"
restore() {
  if [[ "$original" == null ]]; then
    adb "${adb_args[@]}" shell settings delete global animator_duration_scale >/dev/null
  else
    adb "${adb_args[@]}" shell settings put global animator_duration_scale "$original" >/dev/null
  fi
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
base="/sdcard/Android/data/$app/files"
adb "${adb_args[@]}" shell am force-stop "$app"
adb "${adb_args[@]}" shell rm -f "$base/choco-verification.json" "$base/choco-reattach-phase.txt" "$base/choco-reattach-resume.txt"
adb "${adb_args[@]}" shell settings put global animator_duration_scale 1
adb "${adb_args[@]}" shell am start -W -n "$app/com.chocopie.verification.ChocoVerificationActivity" --ez reducedReattach true
ready=false
fail_if_result() {
  if adb "${adb_args[@]}" shell cat "$base/choco-verification.json" > "$output/result.json" 2>/dev/null; then
    python3 - "$output/result.json" <<'PYFAIL'
import json,pathlib,sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
if result['status']=='failed':
    print(json.dumps(result,indent=2),file=sys.stderr)
    sys.exit(1)
PYFAIL
  fi
}
for attempt in $(seq 1 30); do
  fail_if_result
  phase="$(adb "${adb_args[@]}" shell cat "$base/choco-reattach-phase.txt" 2>/dev/null | tr -d '\r' || true)"
  if [[ "$phase" == detached ]]; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Retained-view detach phase timed out' >&2; exit 1; }
adb "${adb_args[@]}" shell settings put global animator_duration_scale 0
adb "${adb_args[@]}" shell touch "$base/choco-reattach-resume.txt"
for attempt in $(seq 1 30); do
  if adb "${adb_args[@]}" shell cat "$base/choco-verification.json" > "$output/result.json" 2>/dev/null; then break; fi
  sleep 1
done
python3 - "$output/result.json" <<'PY'
import json,pathlib,sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
print(json.dumps(result,indent=2))
assert result['status']=='passed', 'Android reduced-motion reattach verification failed'
PY
printf '%s\n' "$original" > "$output/original-animator-duration-scale.txt"
adb "${adb_args[@]}" logcat -d -s ChocoVerification:V AndroidRuntime:E > "$output/logcat.txt"
