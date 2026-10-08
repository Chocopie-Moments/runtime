import hashlib
import json
import pathlib
import os
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('restore-android-artifacts.py').resolve()

class AndroidArtifactAdmission(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.incoming = self.root / 'download'
        self.stage = self.incoming / 'packages/react-native/android/src/main'
        def write(base, name, data):
            path = base / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        sources = {}
        for name in ['ChocoNative.kt', 'ChocoView.kt']:
            path = 'native/android/src/main/java/com/chocopie/' + name
            sources[path] = write(self.root, path, name.encode())['sha256']
        write(self.root, 'native/renderer/patch.json', b'{}')
        artifact = write(self.stage, 'jniLibs/arm64-v8a/libchoco.so', b'admitted-jni')
        notice = write(self.stage, 'third-party/android-ndk/NOTICE', b'notice')
        self.receipt = {'source': '1' * 40, 'dirty': False, 'artifacts': [{'path': 'arm64-v8a/libchoco.so', **artifact}],
                        'notices': {'third-party/android-ndk/NOTICE': notice},
                        'sources': sources, 'rendererPatches': {}}
        self.receipt_path = self.stage / 'ANDROID-BUILD.json'
        self.receipt_path.write_text(json.dumps(self.receipt))
        sdk = self.incoming / 'release/android-sdk'
        record = write(sdk, 'choco-android-sdk-release.aar', b'admitted-aar')
        (sdk / 'SDK-BUILD.json').write_text(json.dumps({'file': 'choco-android-sdk-release.aar', **record}))
        self.destination = self.root / 'packages/react-native/android/src/main'

    def run_admission(self):
        return subprocess.run(['python3', str(SCRIPT), str(self.incoming)], cwd=self.root,
                              capture_output=True, text=True, env={**os.environ, 'GITHUB_SHA': '1' * 40})

    def test_admits_and_restores_binary_notices_sdk_and_canonical_source(self):
        result = self.run_admission()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.destination / 'jniLibs/arm64-v8a/libchoco.so').read_bytes(), b'admitted-jni')
        self.assertEqual((self.destination / 'java/com/chocopie/ChocoView.kt').read_bytes(), b'ChocoView.kt')
        self.assertEqual((self.root / 'release/android-sdk/choco-android-sdk-release.aar').read_bytes(), b'admitted-aar')

    def test_other_revision_is_rejected_before_restoration(self):
        self.receipt['source'] = '2' * 40
        self.receipt_path.write_text(json.dumps(self.receipt))
        self.assertNotEqual(self.run_admission().returncode, 0)
        self.assertFalse(self.destination.exists())

    def test_changed_binary_is_rejected_before_restoration(self):
        (self.stage / 'jniLibs/arm64-v8a/libchoco.so').write_bytes(b'changed')
        self.assertNotEqual(self.run_admission().returncode, 0)
        self.assertFalse(self.destination.exists())

    def test_changed_source_is_rejected_before_restoration(self):
        (self.root / 'native/android/src/main/java/com/chocopie/ChocoView.kt').write_bytes(b'changed')
        self.assertNotEqual(self.run_admission().returncode, 0)
        self.assertFalse(self.destination.exists())

    def test_escaping_artifact_path_is_rejected_before_restoration(self):
        self.receipt['artifacts'][0]['path'] = '../../outside.so'
        self.receipt_path.write_text(json.dumps(self.receipt))
        self.assertNotEqual(self.run_admission().returncode, 0)
        self.assertFalse(self.destination.exists())

if __name__ == '__main__':
    unittest.main()
