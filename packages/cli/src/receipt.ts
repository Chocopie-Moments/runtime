import { z } from 'zod';
import { decodeChoco } from '../../../src/codec/codec.ts';
import { CliError, digest, read } from './files.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const installation = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), asset: z.string(), sha256: hash,
  files: z.record(z.string(), hash), target: z.enum(['web', 'react', 'react-native']),
}).strict();
const dependency = z.object({ value: z.string(), version: z.string(), previous: z.string().nullable(), artifact: z.string(), sha256: hash }).strict();
const schema = z.object({ version: z.literal(1), installations: z.array(installation).max(100), dependencies: z.record(z.string(), dependency),
  metro: z.object({ path: z.string(), previous: z.string().nullable(), sha256: hash }).strict().optional(),
}).strict();
export type Receipt = z.infer<typeof schema>;
export const RECEIPT = '.choco/installations.json';
export function receipt(root: string, value = read(root, RECEIPT)): Receipt {
  if (value === null) return { version: 1, installations: [], dependencies: {} };
  const parsed = schema.parse(JSON.parse(value.toString()));
  if (new Set(parsed.installations.map(item => item.name)).size !== parsed.installations.length) throw new CliError('receipt', 'Duplicate installation names in the receipt.');
  return parsed;
}
export async function installedAssets(root: string, installed: Receipt) {
  return Promise.all(installed.installations.map(async (item) => {
    const value = read(root, item.asset);
    if (value === null || digest(value) !== item.sha256) throw new CliError('conflict', `Installed asset changed: ${item.asset}. Restore it before updating the runtime.`);
    return (await decodeChoco(value)).manifest;
  }));
}
export function ownedFiles(root: string, installed: Receipt) {
  return installed.installations.flatMap(item => Object.entries(item.files).map(([path, hash]) => {
    const value = read(root, path);
    return { path, matches: value !== null && digest(value) === hash };
  }));
}
