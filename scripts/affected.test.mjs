import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeOf } from './affected.mjs';

test('runs only the CLI for CLI changes, nothing for docs, everything otherwise', () => {
  assert.equal(scopeOf(['packages/cli/src/index.ts', 'packages/cli/package.json']), 'cli');
  assert.equal(scopeOf(['packages/cli/src/index.ts', 'README.md', 'docs/releasing.md']), 'cli');
  assert.equal(scopeOf(['README.md', 'docs/choco-format.md']), 'docs');
  for (const path of ['docs/spec/choco.schema.json', 'third-party/js/fflate-0.8.3/LICENSE.md', 'packages/cli/src/metro.ts', 'packages/cli/src/usage.ts', 'packages/cli/test-native-installed.mjs', 'native/android/README.md', 'src/codec/codec.ts', 'packages/runtime/src/index.ts', 'packages/react/src/index.tsx', 'native/choco-core/src/lib.rs', 'package-lock.json', '.github/workflows/build.yml', 'scripts/package.mjs', 'fixtures/admission.json', 'packages/react-native/README.md'])
    assert.equal(scopeOf(['packages/cli/src/index.ts', path]), 'full', path);
});
