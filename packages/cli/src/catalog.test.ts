import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog, pinnedDownload } from './catalog.ts';
import { bytes, digest } from './files.ts';

afterEach(() => vi.unstubAllGlobals());

describe('pinned remote release catalog', () => {
  it('checks catalog and relative package hashes before exposing copied artifacts', async () => {
    const artifact = bytes('reviewed packed native artifact');
    const source = 'a'.repeat(40);
    const content = bytes(JSON.stringify({ version: 1, source, format: 0, semantics: 1, capabilities: [], packages: {
      '@chocopie/react-native': { version: '0.1.0-dev.0', file: './native.tgz', sha256: digest(artifact) },
    } }));
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { requested.push(url); return new Response(url.endsWith('release.json') ? content : artifact); });
    const release = await catalog('https://releases.example/0.1.0/release.json', { sha256: digest(content) });
    expect(requested).toEqual(['https://releases.example/0.1.0/release.json', 'https://releases.example/0.1.0/native.tgz']);
    expect(release.packages[0].data).toEqual(artifact);
    expect(release.source).toBe(source);
    expect(release.packages[0].path).toBe(`.choco/packages/${digest(artifact)}.tgz`);
  });

  it('rejects an unpinned catalog, bad hashes, oversized artifacts, and insecure redirects', async () => {
    const fetch = vi.fn(async () => new Response('wrong bytes'));
    vi.stubGlobal('fetch', fetch);
    await expect(catalog('https://releases.example/release.json')).rejects.toThrow('--catalog-sha256');
    expect(fetch).not.toHaveBeenCalled();
    await expect(pinnedDownload('https://releases.example/package.tgz', '0'.repeat(64), 100)).rejects.toThrow('SHA-256');
    await expect(pinnedDownload('https://releases.example/package.tgz', '0'.repeat(64), 1)).rejects.toThrow('download-size');
    fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'http://insecure.example/package.tgz' } }));
    await expect(pinnedDownload('https://releases.example/package.tgz', '0'.repeat(64), 100)).rejects.toThrow('redirects must use HTTPS');
  });

  it('makes no network request in offline mode', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(catalog('https://releases.example/release.json', { sha256: '0'.repeat(64), offline: true })).rejects.toThrow('offline mode');
    expect(fetch).not.toHaveBeenCalled();
  });
});
