import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digest } from './files.ts';
import { MOMENT_ID, reportAdded, resolveMoment } from './resolve.ts';

const id = 'rhode-empty-TsMR9fyM0mo6JhuHYgu7jA';
const asset = readFileSync(new URL('../../../fixtures/ambient.float.choco', import.meta.url));
const catalog = { url: 'https://github.com/Chocopie-Moments/runtime/releases/download/v0.1.0/catalog.json', sha256: 'c'.repeat(64) };
const answer = (overrides: object = {}) => ({
  format: 'chocopie-install', version: 1, id, name: 'rhode-empty',
  asset: { url: `https://app.chocopie.lol/r/${id}/moment.choco`, sha256: digest(asset), bytes: asset.length },
  catalog, ...overrides,
});
function serve(resolution: Response | (() => Response), bytes: Buffer = asset) {
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (address: string | URL) => {
    const url = String(address);
    requested.push(url);
    return url.endsWith('/install') ? (typeof resolution === 'function' ? resolution() : resolution) : new Response(new Uint8Array(bytes));
  }));
  return requested;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('resolving a Chocopie moment id', () => {
  it('recognizes export ids and not file names', () => {
    expect(MOMENT_ID.test(id)).toBe(true);
    for (const value of ['./rhode.choco', 'rhode.choco', 'https://app.chocopie.lol/r/x/moment.choco', 'rhode-short']) expect(MOMENT_ID.test(value)).toBe(false);
  });

  it('downloads the exact pinned asset and hands back its name and catalog', async () => {
    const requested = serve(Response.json(answer()));
    const resolved = await resolveMoment(id);
    expect(requested).toEqual([`https://app.chocopie.lol/r/${id}/install`, `https://app.chocopie.lol/r/${id}/moment.choco`]);
    expect(resolved.name).toBe('rhode-empty');
    expect(resolved.catalog).toEqual(catalog);
    expect(resolved.data.equals(asset)).toBe(true);
  });

  it('refuses asset bytes that differ from the resolved hash', async () => {
    serve(Response.json(answer()), Buffer.from('other bytes'));
    await expect(resolveMoment(id)).rejects.toThrow('SHA-256');
  });

  it('refuses answers that are not a valid install description for this id', async () => {
    for (const bad of [answer({ id: 'other-TsMR9fyM0mo6JhuHYgu7jA' }), answer({ catalog: { url: 'https://evil.example/catalog.json', sha256: 'c'.repeat(64) } }), answer({ catalog: { url: 'https://github.com/someone/else/releases/download/v1/catalog.json', sha256: 'c'.repeat(64) } }), answer({ asset: { url: `http://app.chocopie.lol/r/${id}/moment.choco`, sha256: digest(asset) } }), answer({ catalog: { url: catalog.url } }), answer({ version: 2 })]) {
      serve(Response.json(bad));
      await expect(resolveMoment(id)).rejects.toThrow('not a valid install description');
    }
  });

  it('refuses an answer larger than install details', async () => {
    serve(new Response('x'.repeat(70_000)));
    await expect(resolveMoment(id)).rejects.toThrow('more than a moment');
  });

  it('says what went wrong when the service refuses', async () => {
    serve(() => Response.json({ error: 'This moment link was revoked or never existed.' }, { status: 404 }));
    await expect(resolveMoment(id)).rejects.toThrow('No Chocopie moment has this id');
    serve(() => Response.json({ error: 'This moment’s frozen runtime has no matching released installer.' }, { status: 409 }));
    await expect(resolveMoment(id)).rejects.toThrow('no matching released installer');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(resolveMoment(id)).rejects.toThrow('could not be reached');
  });

  it('makes no request offline and accepts only an HTTPS origin', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(resolveMoment(id, true)).rejects.toThrow('offline mode');
    vi.stubEnv('CHOCOPIE_ORIGIN', 'http://chocopie.example');
    await expect(resolveMoment(id)).rejects.toThrow('HTTPS origin');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reaches a development server on this machine, and only there over HTTP', async () => {
    vi.stubEnv('CHOCOPIE_ORIGIN', 'http://127.0.0.1:5188');
    const local = `http://127.0.0.1:5188/r/${id}/moment.choco`;
    const requested = serve(Response.json(answer({ asset: { url: local, sha256: digest(asset) } })));
    expect((await resolveMoment(id)).data.equals(asset)).toBe(true);
    expect(requested).toEqual([`http://127.0.0.1:5188/r/${id}/install`, local]);
    serve(Response.json(answer({ asset: { url: `http://chocopie.example/r/${id}/moment.choco`, sha256: digest(asset) } })));
    await expect(resolveMoment(id)).rejects.toThrow('not a valid install description');
  });

  it('reports where it was added without ever failing the install', async () => {
    const sent: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => { sent.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(null, { status: 204 }); }));
    const moment = { id, origin: 'https://app.chocopie.lol', name: 'rhode-empty', data: asset, catalog };
    await reportAdded(moment, { project: 'x'.repeat(120), file: 'src/choco/rhode-empty.tsx', target: 'react' });
    expect(sent).toEqual([{ url: `https://app.chocopie.lol/r/${id}/installed`, body: { project: 'x'.repeat(80), file: 'src/choco/rhode-empty.tsx', target: 'react' } }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: () => Promise.reject(new Error('broken')) }))));
    await expect(reportAdded(moment, { project: 'a', file: 'src/choco/rhode-empty.tsx', target: 'react' })).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(reportAdded(moment, { project: 'a', file: 'src/choco/rhode-empty.tsx', target: 'react' })).resolves.toBeUndefined();
  });
});
