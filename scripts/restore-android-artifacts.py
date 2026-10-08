"""Admit same-run Android build artifacts before combined native packaging."""
import hashlib
import json
import pathlib
import os
import subprocess
import shutil
import sys

root = pathlib.Path.cwd()
incoming = pathlib.Path(sys.argv[1]).resolve()
staged = incoming / 'packages/react-native/android/src/main'
receipt = json.loads((staged / 'ANDROID-BUILD.json').read_text())
source = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
assert receipt['source'] == source and receipt['dirty'] is False, 'Android artifacts must come from this exact clean source revision'

def contained(base, relative):
    path = (base / relative).resolve()
    assert path.is_relative_to(base.resolve()), f'Artifact path escapes its root: {relative}'
    return path

def digest(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

assert receipt['artifacts'] and receipt['notices'], 'Android build receipt is incomplete'
assert receipt['rendererPatches'] == json.loads((root / 'native/renderer/patch.json').read_text())
for artifact in receipt['artifacts']:
    assert digest(contained(staged / 'jniLibs', artifact['path'])) == {key: artifact[key] for key in ['bytes', 'sha256']}
assert {item['path'] for item in receipt['artifacts']} == {
    str(path.relative_to(staged / 'jniLibs')) for path in (staged / 'jniLibs').glob('*/libchoco.so')
}
for name, expected in receipt['sources'].items():
    assert digest(contained(root, name))['sha256'] == expected, f'Android source mismatch: {name}'
for name, expected in receipt['notices'].items():
    assert digest(contained(staged, name)) == expected, f'Android notice mismatch: {name}'
sdk = incoming / 'release/android-sdk'
sdk_receipt = json.loads((sdk / 'SDK-BUILD.json').read_text())
assert digest(contained(sdk, sdk_receipt['file'])) == {key: sdk_receipt[key] for key in ['bytes', 'sha256']}
# Only admitted binary/notice directories are restored; host source comes from this checkout.
destination = root / 'packages/react-native/android/src/main'
for name in ['jniLibs', 'third-party']:
    target = destination / name
    if target.exists(): shutil.rmtree(target)
    shutil.copytree(staged / name, target)
shutil.copyfile(staged / 'ANDROID-BUILD.json', destination / 'ANDROID-BUILD.json')
java = destination / 'java/com/chocopie'
java.mkdir(parents=True, exist_ok=True)
for name in ['ChocoNative.kt', 'ChocoView.kt']:
    shutil.copyfile(root / 'native/android/src/main/java/com/chocopie' / name, java / name)
# Proof APKs remain separate evidence; only the reviewed SDK and its receipt enter release staging.
output = root / 'release/android-sdk'
output.mkdir(parents=True, exist_ok=True)
for name in [sdk_receipt['file'], 'SDK-BUILD.json']:
    shutil.copyfile(contained(sdk, name), output / name)
print('Verified and restored Android JNI, notices and independent SDK from the same workflow run.')
