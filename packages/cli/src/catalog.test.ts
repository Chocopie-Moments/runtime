import { afterEach, describe, expect, it, vi } from 'vitest';
import { STALL_MS, catalog, pinnedDownload } from './catalog.ts';
import { bytes, digest } from './files.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('pinned remote release catalog', () => {
  it('checks catalog and relative package hashes before exposing copied artifacts', async () => {
    const artifact = bytes('reviewed packed native artifact');
    const source = 'a'.repeat(40);
    const content = bytes(JSON.stringify({ version: 1, source, format: 0, semantics: 1, capabilities: [], packages: {
      '@chocopie-moments/react-native': { version: '0.1.0-dev.0', file: './native.tgz', sha256: digest(artifact) },
    } }));
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { requested.push(url); return new Response(url.endsWith('release.json') ? content : artifact); });
    const release = await catalog('https://releases.example/0.1.0/release.json', { sha256: digest(content) });
    expect(requested).toEqual(['https://releases.example/0.1.0/release.json', 'https://releases.example/0.1.0/native.tgz']);
    expect(release.packages[0].data).toEqual(artifact);
    expect(release.source).toBe(source);
    expect(release.packages[0].path).toBe(`.choco/packages/${digest(artifact)}.tgz`);
    // A project that needs only the web runtime never downloads the native package.
    requested.length = 0;
    const web = await catalog('https://releases.example/0.1.0/release.json', { sha256: digest(content), packages: new Set(['@chocopie-moments/runtime']) });
    expect(requested).toEqual(['https://releases.example/0.1.0/release.json']);
    expect(web.packages).toEqual([]);
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

  it('lets a slow download finish and abandons only one that stops', async () => {
    vi.useFakeTimers();
    const parts = ['slow ', 'large ', 'package'];
    const artifact = bytes(parts.join(''));
    // Each part arrives just inside the stall limit, so the whole download outlasts it; a body that
    // stops is errored by its abort signal, as Node's fetch does.
    const serve = (count: number) => vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        init.signal?.addEventListener('abort', () => stream.error(init.signal?.reason));
        parts.slice(0, count).forEach((part, i) => setTimeout(() => stream.enqueue(bytes(part)), (STALL_MS - 1000) * (i + 1)));
        if (count === parts.length) setTimeout(() => stream.close(), (STALL_MS - 1000) * (count + 1));
      },
    })));
    serve(parts.length);
    const done = pinnedDownload('https://releases.example/package.tgz', digest(artifact), 100);
    await vi.advanceTimersByTimeAsync(STALL_MS * (parts.length + 1));
    await expect(done).resolves.toEqual(artifact);
    serve(1);
    const failed = expect(pinnedDownload('https://releases.example/package.tgz', digest(artifact), 100)).rejects.toThrow('The download stopped for 30 s');
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    await failed;
  });

  it('makes no network request in offline mode', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(catalog('https://releases.example/release.json', { sha256: '0'.repeat(64), offline: true })).rejects.toThrow('offline mode');
    expect(fetch).not.toHaveBeenCalled();
  });
});
