#!/bin/bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
ndk="${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME}"
jobs="${CHOCO_BUILD_JOBS:-2}"
api="${CHOCO_ANDROID_API:-24}"
case "$(uname -s)" in
    Darwin) ndk_host=darwin-x86_64 ;;
    Linux) ndk_host=linux-x86_64 ;;
    *) printf 'Unsupported NDK host\n' >&2; exit 1 ;;
  esac
  tools="$ndk/toolchains/llvm/prebuilt/$ndk_host/bin"
# Stage all requested ABIs together so a changed API/toolchain cannot attest stale slices.
stage="$(mktemp -d "${TMPDIR:-/tmp}/choco-android.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
printf '{ global: Java_com_chocopie_ChocoNative_*; local: *; };\n' > "$stage/exports.map"
for abi in ${CHOCO_ANDROID_ABIS:-arm64-v8a}; do
  case "$abi" in
    arm64-v8a) target=aarch64-linux-android; renderer=android-arm64 ;;
    x86_64) target=x86_64-linux-android; renderer=android-x86_64 ;;
    *) printf 'Unsupported ABI: %s\n' "$abi" >&2; exit 1 ;;
  esac
  bash "$repo/scripts/choco/build-renderer.sh" "$renderer"
  cache="${CHOCO_NATIVE_CACHE:-$HOME/Library/Caches/chocopie-native}"
  export CHOCO_THORVG_LIB="$cache/build-$renderer-1ad1dc5ce54bfcb6cdee294760f2728785db2d58/src"
  linker_var="CARGO_TARGET_$(printf '%s' "$target" | tr '[:lower:]-' '[:upper:]_')_LINKER"
  export "$linker_var=$tools/${target}${api}-clang"
  CARGO_BUILD_JOBS="$jobs" cargo build --locked --release --lib --target "$target" --manifest-path "$repo/native/choco-native/Cargo.toml"
  destination="$stage/jniLibs/$abi"
  mkdir -p "$destination"
  "$tools/${target}${api}-clang++" -shared -fPIC -O2 -std=c++17 -static-libstdc++ -Wl,-z,max-page-size=16384 -Wl,--version-script="$stage/exports.map" \
    -I"$repo/native/choco-native/include" "$repo/native/android/src/main/cpp/choco-jni.cpp" \
    "$repo/native/choco-native/target/$target/release/libchoco_native.a" -ljnigraphics -llog -ldl -lm -o "$destination/libchoco.so"
  "$tools/llvm-strip" --strip-unneeded "$destination/libchoco.so"
done
rm -rf "$repo/packages/react-native/android/src/main/jniLibs"
mv "$stage/jniLibs" "$repo/packages/react-native/android/src/main/jniLibs"
mkdir -p "$repo/packages/react-native/android/src/main/java/com/chocopie"
cp "$repo/native/android/src/main/java/com/chocopie/"*.kt "$repo/packages/react-native/android/src/main/java/com/chocopie/"
python3 - "$repo/packages/react-native/android/src/main/jniLibs" "$api" "$ndk" "$repo" "$cache" "$tools" <<'PY'
import hashlib,json,pathlib,shutil,subprocess,sys
root=pathlib.Path(sys.argv[1]); api=int(sys.argv[2]); ndk=pathlib.Path(sys.argv[3]); repo=pathlib.Path(sys.argv[4]); artifacts=[dict(path=str(p.relative_to(root)),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(root.glob('*/libchoco.so'))]
notices=sorted(p for p in ndk.glob('NOTICE*') if p.is_file())
assert notices, 'Installed NDK must contain its third-party notices'
notice_directory=root.parent/'third-party'/'android-ndk'
notice_directory.mkdir(parents=True,exist_ok=True)
for notice in notices: shutil.copyfile(notice,notice_directory/notice.name)
notice_hashes={str(p.relative_to(root.parent)):dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(notice_directory.iterdir()) if p.is_file()}
source_paths=[repo/'native/android/src/main/cpp/choco-jni.cpp',*sorted((repo/'native/android/src/main/java/com/chocopie').glob('*.kt')),repo/'scripts/choco/build-android-package.sh',repo/'scripts/choco/build-renderer.sh',repo/'native/choco-native/include/choco.h']
for crate in ['native/choco-core','native/choco-native']:
 directory=repo/crate
 source_paths += [directory/'Cargo.toml',directory/'Cargo.lock',*sorted((directory/'src').rglob('*.rs'))]
 if (directory/'build.rs').exists(): source_paths.append(directory/'build.rs')
sources={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
cache=pathlib.Path(sys.argv[5]); tools=pathlib.Path(sys.argv[6]); renderer={}
for artifact in artifacts:
 abi=pathlib.Path(artifact['path']).parts[0]; target={'arm64-v8a':'android-arm64','x86_64':'android-x86_64'}[abi]
 build=cache/f'build-{target}-1ad1dc5ce54bfcb6cdee294760f2728785db2d58'; evidence=json.loads((build/'provenance.json').read_text())
 assert evidence['target']==target and evidence['fpContract']=='off' and evidence['patch']==json.loads((repo/'native/renderer/patch.json').read_text())
 assert evidence['sha256']==hashlib.sha256((build/'src/libthorvg-1.a').read_bytes()).hexdigest()
 renderer[abi]=evidence
record=dict(source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo)),artifacts=artifacts,notices=notice_hashes,api=api,ndk=(ndk/'source.properties').read_text(),sources=sources,rendererPatches=json.loads((repo/'native/renderer/patch.json').read_text()),renderer=renderer,rust=subprocess.check_output(['rustc','--version','--verbose'],text=True).strip(),clang=subprocess.check_output([str(tools/'clang'),'--version'],text=True).strip())
(root.parent/'ANDROID-BUILD.json').write_text(json.dumps(record,indent=2)+'\n')
PY
