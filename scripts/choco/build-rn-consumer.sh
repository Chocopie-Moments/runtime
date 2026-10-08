#!/bin/bash
# Build a real, standalone RN release consumer using the staged tarball. No publication.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CHOCO_RN_CONSUMER:?Set an isolated React Native 0.87.1 template application}"
: "${CHOCO_RN_PACKAGE:?Set the exact packed RN tarball}"
jobs="${CHOCO_BUILD_JOBS:-2}"
profile="${CHOCO_RN_PROFILE:-react-native}"
rn_version="${CHOCO_RN_EXPECTED_VERSION:-0.87.1}"
scheme="${CHOCO_RN_SCHEME:-ChocoRNProof}"
peer_override="${CHOCO_ALLOW_PEER_PROOF:-0}"
export CARGO_BUILD_JOBS="$jobs"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export ENTERPRISE_REPOSITORY="${ENTERPRISE_REPOSITORY:-https://repo.maven.apache.org/maven2}"
repository="$PWD"
consumer="$(cd "$CHOCO_RN_CONSUMER" && pwd -P)"
tarball="$(python3 -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve())' "$CHOCO_RN_PACKAGE")"
python3 - "$consumer" "$repository" "$profile" "$rn_version" <<'PREPARE'
import json,pathlib,shutil,sys
app,repo=map(pathlib.Path,sys.argv[1:3]); profile,rn_version=sys.argv[3:]
assert app != repo and not app.is_relative_to(repo), 'Use an isolated consumer, outside the runtime checkout'
assert profile in ['react-native','expo'], 'Unknown consumer profile'
assert json.loads((app/'node_modules/react-native/package.json').read_text())['version']==rn_version, 'Wrong React Native consumer version'
if profile=='expo':
    assert rn_version=='0.86.3', 'Expo proof currently pins RN 0.86.3'
    assert json.loads((app/'node_modules/expo/package.json').read_text())['version']=='57.0.17', 'Expo proof currently pins Expo 57.0.17'
shutil.copyfile(repo/'native/react-native/VerificationApp.tsx',app/'App.tsx')
(app/'assets').mkdir(exist_ok=True)
for source,target in [('beat.flow.choco','flow.choco'),('beat.drawOn.choco','strokes.choco'),('ambient.pulse.choco','pulse.choco')]:
    shutil.copyfile(repo/'fixtures'/source,app/'assets'/target)
metro='expo/metro-config' if profile=='expo' else '@react-native/metro-config'
(app/'metro.config.js').write_text(f"const {{getDefaultConfig}}=require('{metro}');\nconst config=getDefaultConfig(__dirname);\nconfig.resolver.assetExts=[...new Set([...config.resolver.assetExts,'choco'])];\nmodule.exports=config;\n")
podfile=app/'ios/Podfile'
podfile.write_text(podfile.read_text().replace('platform :ios, min_ios_version_supported', "platform :ios, '16.0'"))
for project in (app/'ios').glob('*.xcodeproj/project.pbxproj'):
    project.write_text(project.read_text().replace('IPHONEOS_DEPLOYMENT_TARGET = 15.1;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;'))
PREPARE
(
  cd "$consumer"
  if [[ "$profile" == "expo" && "$peer_override" == "1" ]]; then
    # Proof-only override. The receipt records the unsupported peer combination until execution passes.
    npm install --offline --ignore-scripts --no-audit --no-fund --save-exact --legacy-peer-deps "$tarball"
  else
    npm install --offline --ignore-scripts --no-audit --no-fund --save-exact "$tarball"
  fi
  npx --offline tsc --noEmit
  cd ios
  # RN supports these local artifact inputs. Select Release tarballs so this proof
  # neither redownloads cached frameworks nor installs Debug frameworks into Release.
  core="$PWD/Pods/ReactNativeCore-artifacts/reactnative-core-$rn_version-release.tar.gz"
  dependencies="$PWD/Pods/ReactNativeDependencies-artifacts/reactnative-dependencies-$rn_version-release.tar.gz"
  hermes="$PWD/Pods/hermes-engine-artifacts/hermes-ios-250829098.0.17-release.tar.gz"
  if [[ -f "$core" && -f "$dependencies" && -f "$hermes" ]]; then
    export RCT_TESTONLY_RNCORE_TARBALL_PATH="$core"
    export RCT_USE_LOCAL_RN_DEP="$dependencies"
    export HERMES_ENGINE_TARBALL_PATH="$hermes"
  fi
  pod install
  xcodebuild -workspace "$scheme.xcworkspace" -scheme "$scheme" -configuration Release -jobs "$jobs" \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$consumer/DerivedData" \
    HERMES_CLI_PATH="$consumer/node_modules/hermes-compiler/hermesc/osx-bin/hermesc" \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
)
python3 - "$consumer" "$tarball" "$profile" "$scheme" "$jobs" "$peer_override" <<'RECEIPT'
import hashlib,json,pathlib,subprocess,sys
consumer,tarball=map(pathlib.Path,sys.argv[1:3]); profile,scheme,jobs,peer_override=sys.argv[3:]
app=consumer/f'DerivedData/Build/Products/Release-iphonesimulator/{scheme}.app'
assert app.is_dir(), 'Missing built Release consumer'
def digest(p): return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
record={'source':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'consumer':str(consumer),'app':str(app),'configuration':'Release','profile':profile,'buildJobs':int(jobs),'nativePackage':{'path':str(tarball),**digest(tarball)},
 'reactNative':json.loads((consumer/'node_modules/react-native/package.json').read_text())['version'],
 'nativePeerDependencies':json.loads((consumer/'node_modules/@chocopie-moments/react-native/package.json').read_text())['peerDependencies'],
 'peerDependencyOverride':profile=='expo' and peer_override=='1',
 'files':{str(p.relative_to(app)):digest(p) for p in app.rglob('*') if p.is_file()},
 'dependencyArtifacts':{str(p.relative_to(consumer)):digest(p) for p in (consumer/'ios/Pods').glob('*-artifacts/*-release.tar.gz')},
 'executionVerified':False,'physicalDeviceVerified':False}
pathlib.Path('scripts/generated').mkdir(exist_ok=True)
if profile=='expo': record['expo']=json.loads((consumer/'node_modules/expo/package.json').read_text())['version']
pathlib.Path(f'scripts/generated/choco-{ "expo" if profile=="expo" else "rn" }-consumer.json').write_text(json.dumps(record,indent=2)+'\n')
print(app)
RECEIPT
