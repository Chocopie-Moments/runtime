#!/bin/bash
# Development WASM build of the same archive reader, motion core and retained vector renderer.
set -euo pipefail
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-${CHOCO_BUILD_JOBS:-2}}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
: "${CHOCO_THORVG_LIB:?Build scripts/choco/build-renderer.sh wasm32 first}"
# Rebuild std with this Emscripten toolchain: Rust's prebuilt std may use a different C ABI.
# See https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-emscripten.html
rust_toolchain="${CHOCO_RUST_TOOLCHAIN:-nightly-2026-10-07}"
[[ "$(rustc "+$rust_toolchain" --version --verbose)" == *'commit-hash: 8d1a76430406c877b35d0b627e7f796dcf0dfeca'* ]] || {
  printf 'Use Rust nightly-2026-10-07 for the reviewed WASM build.\n' >&2; exit 1;
}
python3 - "$CHOCO_THORVG_LIB" <<'VERIFY'
import hashlib,json,pathlib,sys
library=pathlib.Path(sys.argv[1]); recorded=json.loads((library.parent/'provenance.json').read_text())
assert recorded['target']=='wasm32' and recorded['revision']=='1ad1dc5ce54bfcb6cdee294760f2728785db2d58', 'Wrong renderer target/revision'
assert recorded['modules']==['cpu','capi'] and not recorded['threads'] and not recorded['fileIO'] and recorded['sanitizer']=='none', 'Wrong renderer features'
assert recorded.get('fpContract')=='off', 'Rebuild the renderer with the reviewed precision settings'
assert recorded['patch']==json.loads(pathlib.Path('native/renderer/patch.json').read_text()), 'Stale renderer patches'
assert recorded['sha256']==hashlib.sha256((library/'libthorvg-1.a').read_bytes()).hexdigest(), 'Renderer library provenance mismatch'
VERIFY
target_dir="$repo/native/choco-native/target-web"
output="$repo/scripts/generated/choco-web"
mkdir -p "$output"
# Keep panic diagnostics while removing machine-specific source paths from release bytes.
# Cargo's encoded form preserves checkout/toolchain paths containing spaces.
separator=$'\x1f'
flags="-C${separator}panic=abort${separator}--remap-path-prefix=$repo=.${separator}--remap-path-prefix=$(rustc "+$rust_toolchain" --print sysroot)=/rust-toolchain${separator}--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
CARGO_PROFILE_RELEASE_OPT_LEVEL=z CARGO_ENCODED_RUSTFLAGS="$flags" cargo "+$rust_toolchain" build --release --lib --locked \
  --manifest-path native/choco-native/Cargo.toml --target wasm32-unknown-emscripten \
  --target-dir "$target_dir" -Z build-std=std,panic_abort -Z build-std-features=optimize_for_size
emcc -Oz -sMALLOC=emmalloc -sDEFAULT_TO_CXX native/web/frame.c \
  "$target_dir/wasm32-unknown-emscripten/release/libchoco_native.a" \
  "$CHOCO_THORVG_LIB/libthorvg-1.a" -lc++ \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=268435456 -sFILESYSTEM=0 \
  '-sEXPORTED_FUNCTIONS=["_malloc","_free","_choco_asset_create","_choco_asset_metadata","_choco_asset_destroy","_choco_player_from_asset","_choco_player_info","_choco_player_hit_test","_choco_player_settled","_choco_player_create","_choco_player_destroy","_choco_player_state","_choco_player_trigger","_choco_player_seek","_choco_player_pause","_choco_player_reduced_motion","_choco_player_look","_choco_player_palette","_choco_web_frame"]' \
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]' \
  -o "$output/choco.mjs"
python3 - "$output" "$CHOCO_THORVG_LIB" "$rust_toolchain" <<'PY'
import gzip, hashlib, json, pathlib, subprocess, sys
output, library, toolchain = sys.argv[1:]
output = pathlib.Path(output)
files = {name: dict(bytes=len(data), gzip=len(gzip.compress(data, mtime=0)), sha256=hashlib.sha256(data).hexdigest())
         for name in ['choco.mjs', 'choco.wasm'] for data in [(output/name).read_bytes()]}
record = dict(files=files, rust=subprocess.check_output(['rustc', '+'+toolchain, '--version', '--verbose'], text=True).strip(),
    build=dict(rustOptLevel='z', panic='abort', stdFeatures=['optimize_for_size'], linkOptLevel='z', allocator='emmalloc', sourcePaths='remapped'),
    emscripten=subprocess.check_output(['emcc', '--version'], text=True).strip(),
    renderer=json.loads((pathlib.Path(library).parent/'provenance.json').read_text()))
(output/'build.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(files))
PY
