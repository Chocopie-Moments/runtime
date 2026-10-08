import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CHOCO_LIMITS } from './archive.ts';
import { fetchChoco } from './load.ts';

const server = createServer((request, response) => {
  if (request.url === '/missing') {
    response.writeHead(404).end();
    return;
  }
  if (request.url === '/declared') {
    response.writeHead(200, { 'content-length': CHOCO_LIMITS.compressed + 1 }).end();
    return;
  }
  if (request.url === '/chunked') {
    response.writeHead(200, { 'transfer-encoding': 'chunked' });
    response.write(new Uint8Array(CHOCO_LIMITS.compressed));
    response.end(new Uint8Array([1]));
    return;
  }
  response.end(new Uint8Array([1, 2, 3]));
});
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test server');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
it('loads real HTTP bytes', async () => {
  expect(await fetchChoco(base)).toEqual(new Uint8Array([1, 2, 3]));
});
it.each(['/declared', '/chunked'])('bounds %s downloads', async (path) => {
  await expect(fetchChoco(base + path)).rejects.toThrow('byte limit');
});
it('reports HTTP failure', async () => {
  await expect(fetchChoco(base + '/missing')).rejects.toThrow('404');
});
it('honors cancellation', async () => {
  await expect(fetchChoco(base, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
});
