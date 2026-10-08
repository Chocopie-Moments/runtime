/** Three real browser engines over the exact packed runtime, using the shared synthetic diagnostic. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const release = resolve(process.argv[2] ?? join(repository, 'release'));
const output = resolve(process.argv[3] ?? join(repository, 'scripts/generated/browser-proof.json'));
const receipt = JSON.parse(readFileSync(join(release, 'artifacts.json'), 'utf8'));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(receipt.source, source, 'Browser proof must use the exact artifact source revision');
assert.equal(receipt.dirty, false, 'Browser proof requires clean reviewed artifacts');
const pin = receipt.packages['@chocopie/runtime'];
assert.match(pin.file, /^[a-zA-Z0-9_.-]+\.tgz$/);
const tarball = join(release, pin.file);
const bytes = readFileSync(tarball);
assert.equal(bytes.length, pin.bytes);
assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
const consumer = mkdtempSync(join(tmpdir(), 'choco-packed-browser-'));
const results = [];
let server;
const evidence = {
  source, runtime: pin, playwright: JSON.parse(readFileSync(new URL('node_modules/playwright/package.json', import.meta.url), 'utf8')).version,
  passed: false, browsers: results,
  limitations: ['Headless engine acceptance does not verify physical Safari or browser/device performance.',
    'Page-hidden/foreground transitions are not established by this headless proof; offscreen and explicit lifecycle suspension are tested.'],
};
async function diagnosticOf(page) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(async () => {
        const { checkBrowser } = await import('/scripts/browser-checks.mjs');
        return checkBrowser();
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser diagnostic exceeded 30 seconds')), 30_000); }),
    ]);
  } finally { clearTimeout(timer); }
}
function contained(root, suffix) {
  const path = resolve(root, suffix);
  assert(!relative(root, path).startsWith('..') && !relative(root, path).includes(':'), 'Static request escapes its root');
  return path;
}
try {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumer, stdio: 'inherit' });
  const packed = join(consumer, 'node_modules/@chocopie/runtime/dist');
  server = createServer((request, response) => {
    try {
      if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><meta charset="utf-8"><title>Packed Chocopie browser proof</title>');
        return;
      }
      let path;
      if (pathname.startsWith('/packages/runtime/dist/')) path = contained(packed, pathname.slice('/packages/runtime/dist/'.length));
      else if (pathname.startsWith('/fixtures/')) path = contained(join(repository, 'fixtures'), pathname.slice('/fixtures/'.length));
      else if (pathname === '/scripts/browser-checks.mjs') path = join(repository, 'scripts/browser-checks.mjs');
      else { response.writeHead(404); response.end(); return; }
      assert(statSync(path).isFile());
      const type = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.choco': 'application/vnd.chocopie' }[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(readFileSync(path));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Serial engines and one page per engine bound CI resource use and make failures attributable.
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 480, height: 480 }, deviceScaleFactor: 1 });
    const external = [];
    const errors = [];
    let result;
    try {
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin, { waitUntil: 'load' });
      const diagnostic = await diagnosticOf(page);
      assert.equal(external.length, 0, 'Playback attempted a remote service');
      assert.deepEqual(errors, [], 'Uncaught browser errors');
      result = { engine: name, version: browser.version(), passed: true, ...diagnostic, externalRequests: external.length };
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      results.push({ engine: name, version: browser.version(), passed: false, error: String(error), errors, externalRequests: external.length });
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
  evidence.passed = true;
} finally {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(consumer, { recursive: true, force: true });
}
