import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, bytes, locked, read, recover, write } from './files.ts';

const roots: string[] = [];
function folder() { const root = mkdtempSync(join(tmpdir(), 'choco-transaction-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('recoverable local installation', () => {
  it('checks all preimages before writing any file', () => {
    const root = folder(); write(root, 'a', bytes('original')); write(root, 'b', bytes('edited'));
    expect(() => apply(root, [{ path: 'a', before: bytes('original'), after: bytes('new') }, { path: 'b', before: null, after: bytes('new') }], () => {})).toThrow('Changed while planning');
    expect(read(root, 'a')?.toString()).toBe('original');
    expect(read(root, '.choco/transaction.json')).toBeNull();
  });
  it('retries interrupted package installation and preserves the exact asset bytes', () => {
    const root = folder();
    expect(() => locked(root, () => apply(root, [{ path: 'asset', before: null, after: bytes('new') }], () => { throw new Error('npm stopped'); }))).toThrow('npm stopped');
    expect(read(root, '.choco/install.lock')).toBeNull();
    let attempts = 0;
    expect(locked(root, () => recover(root, () => { attempts++; }))).toBe('completed');
    expect(attempts).toBe(1); expect(read(root, 'asset')?.toString()).toBe('new');
    expect(read(root, '.choco/transaction.json')).toBeNull();
  });
  it('does not restore over an edit made after interruption', () => {
    const root = folder();
    expect(() => apply(root, [{ path: 'asset', before: null, after: bytes('new') }], () => { throw new Error('stopped'); })).toThrow();
    write(root, 'asset', bytes('my edit'));
    expect(() => recover(root, () => {})).toThrow('preserved your edit');
    expect(read(root, 'asset')?.toString()).toBe('my edit');
  });
  it('rolls back a partial writing phase without starting a package manager', () => {
    const root = folder(); write(root, 'a', bytes('new'));
    write(root, '.choco/transaction.json', bytes(JSON.stringify({ version: 1, phase: 'writing', changes: [{ path: 'a', before: bytes('old').toString('base64'), after: bytes('new').toString('base64') }, { path: 'b', before: null, after: bytes('new').toString('base64') }] })));
    expect(recover(root, () => { throw new Error('must not run'); })).toBe('restored');
    expect(read(root, 'a')?.toString()).toBe('old'); expect(read(root, 'b')).toBeNull();
  });
  it('refuses symlink parents and keeps another install lock', () => {
    const root = folder(); const outside = folder(); symlinkSync(outside, join(root, 'assets'));
    expect(() => write(root, 'assets/file', bytes('wrong'))).toThrow('symbolic link');
    expect(read(outside, 'file')).toBeNull();
    locked(root, () => { expect(() => locked(root, () => {})).toThrow('owns the lock'); });
    mkdirSync(join(root, '.choco'), { recursive: true }); writeFileSync(join(root, '.choco/install.lock'), 'different');
    expect(() => locked(root, () => {})).toThrow('owns the lock');
    expect(read(root, '.choco/install.lock')?.toString()).toBe('different');
  });
});
