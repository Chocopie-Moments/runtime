#!/bin/bash
# Stage the exact local Swift Package and its two arm64 slices; does not publish anything.
set -euo pipefail
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-${CHOCO_BUILD_JOBS:-2}}"
cd "$(dirname "$0")/../.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cache="${CHOCO_NATIVE_CACHE:-$HOME/Library/Caches/chocopie-native}"
revision=1ad1dc5ce54bfcb6cdee294760f2728785db2d58
stage="$(mktemp -d "${TMPDIR:-/tmp}/choco-package.XXXXXX")"
mkdir -p "$stage/Artifacts"
python3 - "$stage/exports.txt" <<'EXPORTS'
import pathlib,re,sys
names=sorted(set(re.findall(r'\b(choco_(?:asset|player)_[a-z_]+)\(',pathlib.Path('native/choco-native/include/choco.h').read_text())))
pathlib.Path(sys.argv[1]).write_text(''.join('_'+name+'\n' for name in names))
EXPORTS
for pair in 'ios-arm64 aarch64-apple-ios iphoneos arm64-apple-ios16.0' 'ios-simulator-arm64 aarch64-apple-ios-sim iphonesimulator arm64-apple-ios16.0-simulator'; do
    read -r backend target sdk_name triple <<< "$pair"
    python3 - "$cache/build-$backend-$revision" "$backend" "$revision" <<'VERIFY'
import hashlib,json,pathlib,sys
build=pathlib.Path(sys.argv[1]); recorded=json.loads((build/'provenance.json').read_text())
assert recorded['target']==sys.argv[2] and recorded['revision']==sys.argv[3], 'Wrong renderer target/revision'
assert recorded['modules']==['cpu','capi'] and not recorded['threads'] and not recorded['fileIO'] and recorded['sanitizer']=='none', 'Wrong renderer features'
assert recorded.get('fpContract')=='off', 'Renderer must use cross-platform floating-point contraction settings'
assert recorded['patch']==json.loads(pathlib.Path('native/renderer/patch.json').read_text()), 'Stale renderer patches; rebuild the backend'
assert recorded['sha256']==hashlib.sha256((build/'src/libthorvg-1.a').read_bytes()).hexdigest(), 'Renderer library does not match its provenance'
VERIFY
    CHOCO_THORVG_LIB="$cache/build-$backend-$revision/src" cargo build --locked --release --lib \
        --target "$target" --manifest-path native/choco-native/Cargo.toml
    framework="$stage/$target/ChocoNative.framework"
    mkdir -p "$framework/Headers" "$framework/Modules"
    cp native/choco-native/include/choco.h "$framework/Headers/"
    cat > "$framework/Modules/module.modulemap" <<'MAP'
framework module ChocoNative { umbrella header "choco.h" export * module * { export * } }
MAP
    sdk="$(xcrun --sdk "$sdk_name" --show-sdk-path)"
    # Keep the implementation private to this image. Only the C contract is exported;
    # another SDK's ThorVG cannot bind to our backend symbols or share its engine globals.
    xcrun clang++ -dynamiclib -O3 -target "$triple" -isysroot "$sdk" \
        -Wl,-force_load,"native/choco-native/target/$target/release/libchoco_native.a" \
        -Wl,-exported_symbols_list,"$stage/exports.txt" -Wl,-dead_strip \
        -install_name @rpath/ChocoNative.framework/ChocoNative \
        -framework Foundation -framework Security -o "$framework/ChocoNative"
    xcrun strip -S -x "$framework/ChocoNative"
    python3 - "$framework" "$sdk_name" <<'PLIST'
import pathlib,plistlib,sys
framework,sdk=sys.argv[1:]
pathlib.Path(framework,'Info.plist').write_bytes(plistlib.dumps(dict(
    CFBundleExecutable='ChocoNative',CFBundleIdentifier='io.chocopie.NativeRuntime',
    CFBundleName='ChocoNative',CFBundlePackageType='FMWK',CFBundleVersion='1',
    CFBundleShortVersionString='0.1.0',MinimumOSVersion='16.0',
    CFBundleSupportedPlatforms=['iPhoneSimulator' if sdk=='iphonesimulator' else 'iPhoneOS'])))
PLIST
    # Fail the package build if any implementation symbol escapes the public contract.
    xcrun nm -gjU "$framework/ChocoNative" | sort > "$stage/$target/actual-exports.txt"
    diff -u "$stage/exports.txt" "$stage/$target/actual-exports.txt"
    cp "$cache/build-$backend-$revision/provenance.json" "$stage/$target/renderer.json"
done
xcrun xcodebuild -create-xcframework \
    -framework "$stage/aarch64-apple-ios/ChocoNative.framework" \
    -framework "$stage/aarch64-apple-ios-sim/ChocoNative.framework" \
    -output "$stage/Artifacts/ChocoNative.xcframework"
cp native/ios/Package.swift "$stage/"
cp -R native/ios/Sources "$stage/"
cp "$cache/build-ios-arm64-$revision/THORVG-LICENSE" "$stage/THORVG-LICENSE"
cp LICENSE NOTICE "$stage/"
cp -R third-party "$stage/third-party"
# Keep the binary tree generated, outside iCloud-backed Documents; record its content hashes.
python3 - "$stage" <<'PY'
import hashlib, json, pathlib, subprocess, sys
stage = pathlib.Path(sys.argv[1])
def digest(p): return dict(bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
files = {str(p.relative_to(stage)): digest(p) for root in ['Artifacts','Sources','third-party'] for p in (stage/root).rglob('*') if p.is_file()}
files['Package.swift']=digest(stage/'Package.swift')
for name in ['LICENSE','NOTICE','THORVG-LICENSE']: files[name]=digest(stage/name)
inputs=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard','native/choco-core','native/choco-native','native/renderer','native/ios','scripts/choco/build-ios-package.sh']).decode().split('\0')
record = dict(source=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(), dirty=bool(subprocess.check_output(['git','status','--porcelain'])), files=files,
    inputs={name:digest(pathlib.Path(name)) for name in inputs if name},
    rust=subprocess.check_output(['rustc','--version','--verbose'],text=True).strip(),
    swift=subprocess.check_output(['xcrun','swiftc','--version'],text=True).strip(),
    renderer={target:json.loads((stage/target/'renderer.json').read_text()) for target in ['aarch64-apple-ios','aarch64-apple-ios-sim']})
(stage/'build.json').write_text(json.dumps(record,indent=2)+'\n')
record['package']=str(stage)
pathlib.Path('scripts/generated').mkdir(parents=True, exist_ok=True)
pathlib.Path('scripts/generated/choco-ios-package.json').write_text(json.dumps(record,indent=2)+'\n')
PY
printf '%s\n' "$stage"
