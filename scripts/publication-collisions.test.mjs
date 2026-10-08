import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPublicationDestinationsAvailable } from './publication-collisions.mjs';
const packages = { '@chocopie/codec': { version: '1.0.0' }, '@chocopie/runtime': { version: '1.0.0' } };
const absent = command => { throw Object.assign(new Error('Absent'), { stdout: JSON.stringify(command === 'npm' ? { error: { code: 'E404' } } : { status: '404' }) }); };
test('admits only explicit registry and release absence', () => {
  assert.doesNotThrow(() => assertPublicationDestinationsAvailable(packages, 'owner/runtime', 'v1.0.0', absent));
});
test('rejects a collision late in the package family before writes', () => {
  const calls = [];
  assert.throws(() => assertPublicationDestinationsAvailable(packages, 'owner/runtime', 'v1.0.0', (command, args) => {
    calls.push([command, args]);
    if (args[1].startsWith('@chocopie/runtime')) return '"1.0.0"';
    return absent(command);
  }), /Registry version already exists/);
  assert(calls.every(([command, args]) => command === 'npm' && args[0] === 'view'));
});
test('rejects an existing release and ambiguous network or authorization failure', () => {
  assert.throws(() => assertPublicationDestinationsAvailable(packages, 'owner/runtime', 'v1.0.0', command => command === 'gh' ? '{}' : absent(command)), /release already exists/);
  for (const stdout of ['', JSON.stringify({ error: { code: 'E401' } })]) {
    assert.throws(() => assertPublicationDestinationsAvailable(packages, 'owner/runtime', 'v1.0.0', () => { throw { stdout }; }), /Cannot establish registry/);
  }
  assert.throws(() => assertPublicationDestinationsAvailable(packages, 'owner/runtime', 'v1.0.0', command => command === 'npm' ? absent(command) : (() => { throw { stdout: '{"status":"403"}' }; })()), /Cannot establish GitHub/);
});
