# Chocopie runtime

**Runtime 0.1.0 is published** for web, iOS and Android. Install the `@chocopie-moments` packages from npm; native SDK artifacts and the pinned Swift Package are in [release v0.1.0](https://github.com/Chocopie-Moments/runtime/releases/tag/v0.1.0).

Implementation of `.choco`: portable drawing and motion data, one Rust behavior engine, and a direct ThorVG vector renderer compiled for native platforms and WebAssembly.

The codec is format 0, revision 2, semantics 1. iOS and React Native iOS lead native development. Android JNI/Kotlin and React Native 0.87.1 Fabric Release execution passed on an Android 16 ARM64 emulator, including R8-minified playback and an offline cold start. The independently packaged, minified Kotlin AAR consumer and strict Expo 57.0.17 / RN 0.86.3 / React 19.2.3 Android Release consumer also passed offline emulator execution. The founder approved `0.1.0` using completed functional checks; physical-device, minimum-OS and performance measurements are deferred until after cutover and remain unverified. The released packages provide browser canvas playback, deterministic frame capture and a React adapter over the same WASM engine. The CLI installs from an explicit hash-pinned local or HTTPS release catalog; all five packages are available at `0.1.0`. The clean release passed packed Chromium, Firefox and WebKit checks plus remote tagged-Swift resolution. Physical-device, minimum-OS/API and performance measurements remain unverified. The hosted product cutover is tracked separately.

Playback is local and offline. Assets contain no executable host code, prompts, account data or remote renderer dependency. A runtime is shared by the moments in an application.

## Repository

- `native/choco-core`: clock, scores, state transitions and effects.
- `native/choco-native`: bounded archive reader, validation, retained drawing and C interface.
- `native/ios`: UIKit and SwiftUI SDK, staged with device/simulator XCFramework slices.
- `native/android`: main-thread Kotlin/bitmap host and JNI adapter over the same Rust/ThorVG engine.
- `packages/react-native`: Fabric adapters over the UIKit and Android owners; bare RN and strict Expo iOS/Android simulator/emulator execution passed for the recorded profiles; physical-device acceptance remains open.
- `src/codec` and `src/format`: archive encoding/decoding, the portable drawing/motion contract, and admission checks. Product authoring schemas, SVG compilation and generation tools belong in the private product.
- `packages/codec`, `packages/runtime`, `packages/react`, `packages/cli`: published codec, web runtime, React adapter and installer.
- `fixtures`: synthetic capability and malformed-input corpus. No customer/community artwork is included.

## Local checks

Use Node 24 and `npm ci`, then `npm run check:spec`, `npm run typecheck`, and `npm test`. Conformance tests consume compiled synthetic fixtures. The private authoring compiler is not needed to build or test the runtime. Outlined lettering fixtures retain their font notices.

For native builds install Rust 1.97.1, Meson 1.9.2, Ninja 1.13 and Xcode with Swift 6.2 or later. `bash scripts/choco/build-renderer.sh macos-arm64` prints `CHOCO_THORVG_LIB`. Set it before `cargo test --locked --manifest-path native/choco-native/Cargo.toml`. Core tests use `cargo test --locked --manifest-path native/choco-core/Cargo.toml`.

For Android, install the NDK and Rust `aarch64-linux-android` target, then run `ANDROID_NDK_HOME=/path/to/ndk bash scripts/choco/build-android-package.sh`. This stages arm64-v8a JNI/Kotlin files and their receipt inside the RN package. API 24 and two build jobs are the defaults; `CHOCO_ANDROID_API`, `CHOCO_ANDROID_ABIS` and `CHOCO_BUILD_JOBS` select explicit alternatives. Run `bash scripts/choco/prepare-android-verification.sh <consumer>` before building a packed Release RN consumer, then `bash scripts/choco/run-android-verification.sh <evidence-directory>` against its installed APK. These checks do not establish physical-device performance until executed on physical hardware. See [Android host notes](native/android/README.md).

macOS currently supports the native core/frame tooling. There is no packaged desktop UI adapter or supported macOS, Windows or Linux application integration. The first cutover targets web, iOS and Android; native desktop is a follow-up, not a prerequisite for those targets.

For WASM, activate Emscripten 6.0.11 and install Rust `nightly-2026-10-07` with `rust-src`. Build the backend with `bash scripts/choco/build-renderer.sh wasm32`, set its printed library path, then run `bash scripts/choco/build-web-proof.sh`. With the native `frames` release executable built, run `node scripts/choco/verify-web.mjs fixtures/manifest.json` for exact native/WASM pixels.

After the WASM build, `npm run build` stages npm tarballs and their hashes under `release/`. `npm run check:packages` installs them in a clean temporary project and exercises the distributed codec and engine. No command publishes packages.

The browser entry point is `loadChoco(source, {signal})` from `@chocopie-moments/runtime`. Load once, then mount independent players with `asset.mount(element, options)`. Destroy each player and dispose the asset when its owner unmounts. Existing players retain their asset data after `asset.dispose()`, but new mounts are rejected. Playback suspends when hidden, offscreen or explicitly disabled. Deterministic tooling uses `asset.frames({width, height})`, whose returned straight-RGBA pixel arrays remain owned by the caller. No DOM is needed for frame capture or module imports during SSR.

`@chocopie-moments/react` exports `Choco` and its imperative `ChocoHandle`. The component owns cancellation, loading/errors, prop updates and disposal. Supply an accessible label for meaningful artwork; omit it for decorative art. Interactive moments require a label. Application business logic remains in the host.

`node packages/cli/test-installed.mjs` verifies the packed installer in clean web and React applications, including generated declarations, SSR, repeated add, update, doctor, conflicts and removal. For real browser lifecycle checks, serve this checkout over HTTP and invoke `checkBrowser()` from `scripts/browser-checks.mjs` in the collaborative browser. That diagnostic checks presentation/capture equality and host lifecycle; it does not measure frame-delivery performance.

See [format](docs/choco-format.md), [release preparation](docs/releasing.md), and [measurements](docs/measurements.md). `IMPORT.json` records the initial source import, including paths subsequently removed during the boundary correction; it is not the current file inventory. This publication baseline contains no earlier repository history. The former repository history remains private and is not part of this source release. Chocopie consumes versioned packages, not a Git submodule.

## License

Our code is Apache-2.0. Third-party code and fonts retain their respective licenses. Open source enables independent auditing; it is not an assertion that a third-party audit has occurred.
