#!/bin/bash
# Build a prebuilt isolated Expo iOS consumer. No package peer admission or execution claim.
# CHOCO_ALLOW_PEER_PROOF=1 permits a recorded proof-only peer override before admission.
set -euo pipefail
: "${CHOCO_EXPO_CONSUMER:?Set an isolated prebuilt Expo 57.0.17 / RN 0.86.3 application}"
: "${CHOCO_RN_PACKAGE:?Set the exact packed RN tarball}"
export CHOCO_RN_CONSUMER="$CHOCO_EXPO_CONSUMER"
export CHOCO_RN_PROFILE=expo
export CHOCO_RN_EXPECTED_VERSION=0.86.3
export CHOCO_RN_SCHEME="${CHOCO_EXPO_SCHEME:-ChocoExpoVerification}"
export CHOCO_BUILD_JOBS="${CHOCO_BUILD_JOBS:-2}"
bash "$(dirname "$0")/build-rn-consumer.sh"
