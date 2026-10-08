# Physical proof application

`VerificationApp.swift`, `VerificationChecks.swift` and `VerificationMetrics.swift` are test application sources, not part of the production SDK. The dedicated bundle is `com.chocopie.runtimeproof`; never substitute another installed application's identity. The physical runner bundles the synthetic `beat.flow.choco` as `flows.choco` and uses its `active`/`other` states.

Signing requires an existing configured Xcode account, available development signing identity, and a provisioning profile including the connected device. If Apple reports a pending Program License Agreement, stop until the team's Account Holder accepts it. Do not sign in or accept agreements through this runner.

Prepare and build against the exact reviewed development ZIP (the output directory must be new):

```sh
python3 scripts/choco/build-ios-physical-proof.py --zip "$SDK_ZIP" --sha256 "$SDK_SHA256" --source "$SDK_SOURCE" --team "$SIGNING_TEAM" --device "$DEVICE_ID" --output "$PROOF_DIRECTORY" --build
```

This builds Release with two workers and minimum iOS 16.0; it does not install or launch. Omitting `--build` only prepares the project. For a separately labeled simulator-only check, add `--simulator-id "$SIMULATOR_ID"`; that unsigned build is rejected by the physical receipt verifier and does not boot a device. Once the signed build succeeds, install only its dedicated application and use a fresh nonce for each attempt:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
PROOF_ID="$(uuidgen)"
xcrun devicectl device install app --device "$DEVICE_ID" "$PROOF_DIRECTORY/DerivedData/Build/Products/Release-iphoneos/ChocoPhysicalProof.app"
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing com.chocopie.runtimeproof --choco-physical-proof --choco-proof-id "$PROOF_ID"
```

After the application's status reports receipt completion, retrieve only its own file into a new attempt path. Do not list or copy other applications' data:

```sh
xcrun devicectl device copy from --device "$DEVICE_ID" --domain-type appDataContainer --domain-identifier com.chocopie.runtimeproof --source Documents/physical-proof.json --destination "$DEVICE_RECEIPT"
python3 scripts/choco/verify-ios-physical-proof.py --receipt "$DEVICE_RECEIPT" --proof-id "$PROOF_ID" --build-json "$PROOF_DIRECTORY/proof-build.json" --output "$EVIDENCE_OUTPUT"
```

The application removes its old receipt before autorun. Success and failure receipts include the nonce; the host refuses mismatched nonces and existing evidence output. Build metadata binds the SDK source/ZIP hash, verification sources, application binary and native framework hashes. Record physical model/OS and exact installation separately.

Metrics cover one synthetic fixture at 160×160 points: warm engine load to first presented image, 10 warm-up and 120 paused seek samples, actual pixel dimensions, median/p95 rendering plus image creation, and whole-app sampled resident memory from Mach `task_info`. They exclude process startup, display scanout, energy and peak-memory claims. Existing SDK checks simulate application notifications; real background/foreground needs a separate device test. Measure process startup separately with Instruments App Launch. An unsigned compile or failed provisioning attempt is not execution evidence.
