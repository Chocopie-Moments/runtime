import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeChoco, encodeChoco } from '../src/codec/codec.ts';
import { CHOCO_CAPABILITIES, requiredCapabilities } from '../src/codec/capabilities.ts';
const fixtures: { id: string; asset: string }[] = JSON.parse(readFileSync('fixtures/manifest.json', 'utf8'));
const corpus = await Promise.all(fixtures.map(async fixture => ({ ...fixture, bytes: readFileSync(fixture.asset), ...await decodeChoco(readFileSync(fixture.asset)) })));
it('covers every declared capability', () => {
  const covered = new Set(corpus.flatMap(({ document }) => requiredCapabilities(document.scene, document.motion).map(({id}) => id)));
  expect([...CHOCO_CAPABILITIES].filter(id => !covered.has(id))).toEqual([]);
});
it.each(corpus)('$id has reproducible bytes and cannot hide required capabilities', async ({ bytes, document, manifest, attribution }) => {
  expect(Buffer.from(await encodeChoco(document, attribution))).toEqual(bytes);
  for (const {id: capability} of manifest.required) {
    const supported = new Set(CHOCO_CAPABILITIES); supported.delete(capability);
    await expect(decodeChoco(bytes, supported)).rejects.toThrow(capability);
  }
});
const cases: {path: string; accepted: boolean}[] = JSON.parse(readFileSync('fixtures/admission.json', 'utf8'));
it.each(cases)('$path preserves admission', async ({path, accepted}) => {
  const decoded = decodeChoco(readFileSync(path));
  if (accepted) await expect(decoded).resolves.toBeDefined();
  else await expect(decoded).rejects.toThrow();
});
it('accepts descriptive categories independently of product labels, with bounded metadata', async () => {
  const document = corpus[0].document;
  expect((await decodeChoco(await encodeChoco({ ...document, kind: 'payment-recovery' }))).manifest.kind).toBe('payment-recovery');
  await expect(encodeChoco({ ...document, kind: '' })).rejects.toThrow();
  await expect(encodeChoco({ ...document, kind: 'x'.repeat(81) })).rejects.toThrow();
});
