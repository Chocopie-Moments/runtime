#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -m)" == arm64 ]] || { printf 'Native conformance currently requires an arm64 Mac.\n' >&2; exit 1; }
npm ci
npm run check:spec
npm run typecheck
npm test
cargo test --locked --manifest-path native/choco-core/Cargo.toml
cache="${CHOCO_NATIVE_CACHE:-$HOME/Library/Caches/chocopie-native}"
revision=1ad1dc5ce54bfcb6cdee294760f2728785db2d58
bash scripts/choco/build-renderer.sh macos-arm64
export CHOCO_THORVG_LIB="$cache/build-macos-arm64-$revision/src"
cargo test --locked --manifest-path native/choco-native/Cargo.toml
cargo clippy --locked --manifest-path native/choco-native/Cargo.toml --all-targets -- -D warnings
cargo build --locked --release --manifest-path native/choco-native/Cargo.toml --bins
node scripts/check-admission.mjs
bash scripts/choco/build-renderer.sh wasm32
export CHOCO_THORVG_LIB="$cache/build-wasm32-$revision/src"
bash scripts/choco/build-web-proof.sh
node scripts/choco/verify-web.mjs fixtures/manifest.json
python3 scripts/notices.py
npm run build
node scripts/prepare-package-cache.mjs
npm run check:packages
