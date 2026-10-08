import { constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';

export class CliError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const bytes = (value: string) => Buffer.from(value, 'utf8');
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Refuse symlinks and non-files along every managed project path. */
export function at(root: string, path: string): string {
  const destination = resolve(root, path);
  const local = relative(root, destination);
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new CliError('path', `Unsafe project path: ${path}`);
  let current = root;
  for (const part of local.split(/[\\/]/)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new CliError('path', `Refusing symbolic link: ${local}`); }
    catch (error) { if (!missing(error)) throw error; }
  }
  return destination;
}
export function read(root: string, path: string): Buffer | null {
  const destination = at(root, path);
  try {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.size > 8_388_608) throw new CliError('path', `Not a bounded regular file: ${path}`);
    const fd = openSync(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return readFileSync(fd); } finally { closeSync(fd); }
  } catch (error) { if (missing(error)) return null; throw error; }
}
export function write(root: string, path: string, value: Uint8Array | null) {
  const destination = at(root, path);
  if (value === null) { if (existsSync(destination)) unlinkSync(destination); return; }
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.choco-${randomUUID()}`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
    at(root, path);
    renameSync(temporary, destination);
    const directory = openSync(dirname(destination), constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
const encoded = (value: Uint8Array | null) => value === null ? null : Buffer.from(value).toString('base64');
const decoded = (value: string | null) => value === null ? null : Buffer.from(value, 'base64');
export const same = (a: Uint8Array | null, b: Uint8Array | null) => a === null || b === null ? a === b : Buffer.from(a).equals(b);
export type Change = { path: string; before: Buffer | null; after: Buffer | null };
const journalSchema = z.object({
  version: z.literal(1), phase: z.enum(['writing', 'packages']),
  changes: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }).strict()).max(100),
}).strict();
const JOURNAL = '.choco/transaction.json';
const LOCK = '.choco/install.lock';
const lockSchema = z.object({ pid: z.number().int().positive(), host: z.string(), id: z.string() }).strict();

export function locked<T>(root: string, action: () => T): T {
  const path = at(root, LOCK);
  mkdirSync(dirname(path), { recursive: true });
  const id = randomUUID();
  try { writeFileSync(path, JSON.stringify({ pid: process.pid, host: hostname(), id }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new CliError('busy', 'Another install owns the lock. If it was interrupted, run choco recover.'); throw error; }
  try { return action(); }
  finally {
    const held = read(root, LOCK);
    if (held !== null && lockSchema.parse(JSON.parse(held.toString())).id === id) unlinkSync(path);
  }
}
export function releaseStaleLock(root: string) {
  const value = read(root, LOCK);
  if (value === null) return;
  const lock = lockSchema.parse(JSON.parse(value.toString()));
  if (lock.host !== hostname()) throw new CliError('busy', 'The install lock belongs to another machine. Finish recovery there.');
  try { process.kill(lock.pid, 0); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') { unlinkSync(at(root, LOCK)); return; }
    throw error;
  }
  throw new CliError('busy', 'The process holding the install lock is still running.');
}
export function assertRecovered(root: string) {
  if (read(root, JOURNAL) !== null) throw new CliError('recovery_needed', 'An earlier install is incomplete. Run choco recover before changing files.');
}

/** Journal every preimage. Package-manager work is recoverable, not advertised as atomic. */
export function apply(root: string, changes: readonly Change[], install: () => void) {
  assertRecovered(root);
  if (new Set(changes.map(change => change.path)).size !== changes.length) throw new CliError('plan', 'An installation plan contains duplicate paths.');
  for (const change of changes) if (!same(read(root, change.path), change.before)) throw new CliError('conflict', `Changed while planning: ${change.path}`);
  const journal = { version: 1, phase: 'writing', changes: changes.map(change => ({ path: change.path, before: encoded(change.before), after: encoded(change.after) })) };
  const serialized = bytes(JSON.stringify(journal));
  if (changes.length > 100 || serialized.length > 8_388_608) throw new CliError('plan_size', 'This transaction exceeds the recovery journal limit. Install or remove fewer assets at once. No files were changed.');
  write(root, JOURNAL, serialized);
  for (const change of changes) {
    if (!same(read(root, change.path), change.before)) throw new CliError('conflict', `Changed during install: ${change.path}. Run choco recover.`);
    write(root, change.path, change.after);
  }
  journal.phase = 'packages';
  write(root, JOURNAL, bytes(JSON.stringify(journal)));
  install();
  write(root, JOURNAL, null);
}

export function recover(root: string, install: () => void): 'none' | 'restored' | 'completed' {
  const value = read(root, JOURNAL);
  if (value === null) return 'none';
  const journal = journalSchema.parse(JSON.parse(value.toString()));
  const checked = new Map<string, Buffer | null>();
  for (const change of journal.changes) {
    const current = read(root, change.path);
    const matches = same(current, decoded(change.after)) || (journal.phase === 'writing' && same(current, decoded(change.before)));
    if (!matches) throw new CliError('conflict', `Recovery preserved your edit to ${change.path}. Restore it to the planned contents before recovering.`);
    checked.set(change.path, current);
  }
  if (journal.phase === 'packages') install();
  else for (const change of [...journal.changes].reverse()) {
    if (!same(read(root, change.path), checked.get(change.path)!)) throw new CliError('conflict', `Changed during recovery: ${change.path}. Your edit was preserved.`);
    write(root, change.path, decoded(change.before));
  }
  write(root, JOURNAL, null);
  return journal.phase === 'packages' ? 'completed' : 'restored';
}
