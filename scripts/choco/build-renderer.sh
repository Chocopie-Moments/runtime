#!/bin/bash
# Pin the direct-drawing backend and its enabled features for Apple and WebAssembly builds.
set -euo pipefail
target="${1:?Use macos-arm64, ios-simulator-arm64, ios-arm64, or wasm32}"
sanitizer="${2:-none}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
revision=1ad1dc5ce54bfcb6cdee294760f2728785db2d58
cache="${CHOCO_NATIVE_CACHE:-$HOME/Library/Caches/chocopie-native}"
source="${CHOCO_THORVG_SOURCE:-$cache/thorvg-$revision}"
build="$cache/build-$target-$revision"
case "$sanitizer" in
  none) ;;
  address)
    [[ "$target" == macos-arm64 ]] || { printf 'AddressSanitizer proof requires macos-arm64.\n' >&2; exit 1; }
    build="$build-asan"
    if [[ -n "${CHOCO_LLVM_BIN:-}" ]]; then build="$build-llvm"; fi ;;
  *) printf 'Unsupported sanitizer: %s\n' "$sanitizer" >&2; exit 1 ;;
esac
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
case "$target" in
  macos-arm64) sdk=macosx; triple=arm64-apple-macos12.0 ;;
  ios-simulator-arm64) sdk=iphonesimulator; triple=arm64-apple-ios16.0-simulator ;;
  ios-arm64) sdk=iphoneos; triple=arm64-apple-ios16.0 ;;
  android-arm64) sdk=android; triple=aarch64-linux-android ;;
  android-x86_64) sdk=android; triple=x86_64-linux-android ;;
  wasm32) sdk=emscripten; triple=wasm32-unknown-emscripten ;;
  *) printf 'Unsupported renderer target: %s\n' "$target" >&2; exit 1 ;;
esac
command -v meson >/dev/null || { printf 'Install Meson 1.9.2 and Ninja 1.13, then add them to PATH.\n' >&2; exit 1; }
mkdir -p "$cache"
if [[ ! -d "$source" ]]; then
  git init "$source"
  git -C "$source" remote add origin https://github.com/thorvg/thorvg.git
  git -C "$source" fetch --depth 1 origin "$revision"
  git -C "$source" checkout --detach "$revision"
fi
[[ "$(git -C "$source" rev-parse HEAD)" == "$revision" ]] || { printf 'Renderer source is not the pinned revision.\n' >&2; exit 1; }
# Only the exact reviewed patch may differ from the pinned upstream tree.
python3 - "$source" "$repo/native/renderer" <<'PATCH'
import hashlib, json, pathlib, subprocess, sys
source, patches = map(pathlib.Path, sys.argv[1:])
metadata = json.loads((patches/'patch.json').read_text())
changed = set(subprocess.check_output(['git','-C',str(source),'diff','--name-only','HEAD'],text=True).splitlines())
assert changed <= {item['file'] for item in metadata}, 'Renderer has unrelated changes'
for item in metadata:
    patch = patches/item['name']
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == item['patch'], 'Renderer patch digest mismatch'
    digest = hashlib.sha256((source/item['file']).read_bytes()).hexdigest()
    if digest == item['original']:
        subprocess.run(['git','-C',str(source),'apply',str(patch)],check=True)
    assert hashlib.sha256((source/item['file']).read_bytes()).hexdigest() == item['patched'], 'Renderer source differs from the reviewed patch'

PATCH
cross="$cache/$target-$sanitizer.ini"
if [[ "$target" == wasm32 ]]; then
  c_compiler="$(command -v emcc)"
  cpp_compiler="$(command -v em++)"
  sdk_path="$(dirname "$c_compiler")"
  "$c_compiler" --version | head -1 | grep -F '6.0.11' >/dev/null || { printf 'Use Emscripten 6.0.11.\n' >&2; exit 1; }
  python3 - "$cross" "$c_compiler" "$cpp_compiler" "$(command -v emar)" "$(command -v emstrip)" <<'CROSS'
import pathlib, sys
path, c, cpp, ar, strip = sys.argv[1:]
pathlib.Path(path).write_text(
    '[binaries]\n' + ''.join(f'{key} = {value!r}\n' for key, value in [('c', c), ('cpp', cpp), ('ar', ar), ('strip', strip)]) +
    "[host_machine]\nsystem = 'emscripten'\ncpu_family = 'wasm32'\ncpu = 'wasm32'\nendian = 'little'\n[properties]\nneeds_exe_wrapper = true\n[built-in options]\ncpp_args = ['-ffp-contract=off']\n")
CROSS
elif [[ "$sdk" == android ]]; then
  ndk="${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to the installed NDK}"
  case "$(uname -s)" in
    Darwin) ndk_host=darwin-x86_64 ;;
    Linux) ndk_host=linux-x86_64 ;;
    *) printf 'Unsupported NDK host\n' >&2; exit 1 ;;
  esac
  tools="$ndk/toolchains/llvm/prebuilt/$ndk_host/bin"
  api="${CHOCO_ANDROID_API:-24}"
  c_compiler="$tools/${triple}${api}-clang"
  cpp_compiler="$tools/${triple}${api}-clang++"
  sdk_path="$ndk"
  python3 - "$cross" "$c_compiler" "$cpp_compiler" "$tools/llvm-ar" "$tools/llvm-strip" "$target" <<'CROSS'
import pathlib, sys
path,c,cpp,ar,strip,target=sys.argv[1:]
cpu='aarch64' if target.endswith('arm64') else 'x86_64'
pathlib.Path(path).write_text('[binaries]\n'+''.join(f'{k} = {v!r}\n' for k,v in [('c',c),('cpp',cpp),('ar',ar),('strip',strip)])+f"[host_machine]\nsystem = 'android'\ncpu_family = '{cpu}'\ncpu = '{cpu}'\nendian = 'little'\n[properties]\nneeds_exe_wrapper = true\n[built-in options]\ncpp_args = ['-ffp-contract=off', '-fPIC']\nc_args = ['-fPIC']\n")
CROSS
else
  sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
  c_compiler="$(xcrun --find clang)"
  cpp_compiler="$(xcrun --find clang++)"
  if [[ "$sanitizer" == address && -n "${CHOCO_LLVM_BIN:-}" ]]; then
    # Apple Clang uses a different ASan ABI from Rust's upstream LLVM runtime.
    llvm_bin="$CHOCO_LLVM_BIN"
    c_compiler="$llvm_bin/clang"
    cpp_compiler="$llvm_bin/clang++"
  fi
  python3 - "$cross" "$triple" "$sdk_path" "$c_compiler" "$cpp_compiler" "$(xcrun --find ar)" "$(xcrun --find strip)" <<'CROSS'
import pathlib, sys
path, target, sdk, c, cpp, ar, strip = sys.argv[1:]
args = ['-target', target, '-isysroot', sdk, '-ffp-contract=off']
pathlib.Path(path).write_text(
    '[binaries]\n' + ''.join(f'{key} = {value!r}\n' for key, value in [('c', c), ('cpp', cpp), ('ar', ar), ('strip', strip)]) +
    "[host_machine]\nsystem = 'darwin'\ncpu_family = 'aarch64'\ncpu = 'arm64'\nendian = 'little'\n[built-in options]\n" +
    ''.join(f'{key} = {args!r}\n' for key in ['c_args', 'cpp_args', 'c_link_args', 'cpp_link_args']))
CROSS
fi
options=(--cross-file "$cross" --buildtype release --default-library static
  -Db_sanitize="$sanitizer"
  -Dengines=cpu -Dloaders= -Dsavers= -Dbindings=capi -Dthreads=false
  -Dstatic=true -Dfile=false -Dextra= -Dtests=false)
if [[ -f "$build/meson-private/coredata.dat" ]]; then
  # Meson caches machine-file built-in options across --reconfigure. Recreate
  # configuration when the toolchain/flags change instead of attesting stale code.
  if cmp -s "$cross" "$build/choco-cross.ini"; then
    meson setup --reconfigure "$build" "$source" "${options[@]}"
  else
    meson setup --wipe "$build" "$source" "${options[@]}"
  fi
else
  meson setup "$build" "$source" "${options[@]}"
fi
cp "$cross" "$build/choco-cross.ini"
meson compile -C "$build" -j "${CHOCO_BUILD_JOBS:-2}"
cp "$source/LICENSE" "$build/THORVG-LICENSE"
python3 - "$build" "$revision" "$target" "$triple" "$sdk_path" "$repo/native/renderer/patch.json" "$sanitizer" "$cpp_compiler" <<'PY'
import hashlib, json, pathlib, shlex, subprocess, sys
directory, revision, target, triple, sdk, patch, sanitizer, compiler = sys.argv[1:]
build = pathlib.Path(directory)
library = build / 'src/libthorvg-1.a'
commands = json.loads((build/'compile_commands.json').read_text())
cpp_commands = [item for item in commands if pathlib.Path(item['file']).suffix == '.cpp']
assert cpp_commands, 'Missing C++ compiler command evidence'
for item in cpp_commands:
    args = shlex.split(item['command'])
    flags = [arg for arg in args if arg.startswith('-ffp-contract=')]
    assert flags and flags[-1] == '-ffp-contract=off', f"Uncontrolled floating-point contraction: {item['file']}"
provenance = dict(renderer='ThorVG', revision=revision, target=target, triple=triple, sdk=sdk,
    sanitizer=sanitizer,
    compiler=subprocess.check_output([compiler,'--version'],text=True).strip(),
    modules=['cpu', 'capi'], threads=False, fileIO=False, fpContract='off', patch=json.loads(pathlib.Path(patch).read_text()),
    meson=subprocess.check_output(['meson','--version'],text=True).strip(),
    xcode=None if target == 'wasm32' or target.startswith('android-') else subprocess.check_output(['xcodebuild','-version'],text=True).strip(),
    sha256=hashlib.sha256(library.read_bytes()).hexdigest(), bytes=library.stat().st_size)
(build/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(provenance))
print(f'CHOCO_THORVG_LIB={library.parent}')
PY
