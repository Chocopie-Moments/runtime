import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { CliError, digest } from './files.ts';

const artifact = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/), file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const catalogSchema = z.object({
  version: z.literal(1), format: z.number().int(), semantics: z.number().int(),
  source: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  capabilities: z.array(z.object({ id: z.string(), version: z.number().int().positive() }).strict()),
  packages: z.object({ '@chocopie-moments/runtime': artifact.optional(), '@chocopie-moments/react': artifact.optional(), '@chocopie-moments/react-native': artifact.optional() }).strict(),
}).strict();
export type Requirements = { formatVersion: number; semanticsVersion: number; required: readonly { id: string; version: number }[] };

/** Local catalogs are explicitly supplied release artifacts; their package hashes are mandatory. */
/** A local development server on this machine; only an explicit CHOCOPIE_ORIGIN reaches one. */
export const loopback = (url: URL) => url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
/** How long a download may receive nothing before it is abandoned. */
export const STALL_MS = 30_000;
export async function pinnedDownload(url: string, sha256: string, limit: number, offline = false, allowLoopback = false): Promise<Buffer> {
  if (offline) throw new CliError('offline', 'Remote assets and catalogs are unavailable in offline mode. Supply verified local files.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new CliError('integrity', 'Supply the exact SHA-256 digest for the remote release artifact.');
  if (new URL(url).protocol !== 'https:' && !(allowLoopback && loopback(new URL(url)))) throw new CliError('source', 'Release artifacts must use HTTPS.');
  // A slow connection may take minutes for a large package; only a download that stops is abandoned.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const progressed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new CliError('source', `The download stopped for ${STALL_MS / 1000} s. Check your connection and run the command again.`)), STALL_MS);
  };
  try {
    let address = url;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      progressed();
      response = await fetch(address, { redirect: 'manual', signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (location === null || redirects === 5) throw new CliError('source', 'The release artifact redirect could not be followed.');
      address = new URL(location, address).href;
      if (new URL(address).protocol !== 'https:') throw new CliError('source', 'Release artifact redirects must use HTTPS.');
    }
    if (response === undefined || !response.ok || response.body === null) throw new CliError('source', 'The release artifact could not be downloaded.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        progressed();
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) throw new CliError('source', 'The release artifact exceeds its download-size limit.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const data = Buffer.concat(chunks);
    if (digest(data) !== sha256) throw new CliError('integrity', 'The downloaded release artifact failed its SHA-256 check.');
    return data;
  } finally { clearTimeout(timer); }
}

/** Only the packages the project needs are read: a web project never downloads the native one. */
export async function catalog(file: string | undefined, options: { sha256?: string; offline?: boolean; packages?: ReadonlySet<string> } = {}) {
  if (file === undefined) throw new CliError('catalog', 'Supply the tested local release catalog with --catalog. No public runtime release is available yet.');
  const remote = file.startsWith('https://');
  if (file.includes('://') && !remote) throw new CliError('catalog', 'Use a local catalog or an HTTPS catalog URL.');
  if (remote && options.sha256 === undefined) throw new CliError('catalog', 'Supply --catalog-sha256 for an HTTPS release catalog.');
  const path = remote ? file : resolve(file);
  const content = remote ? await pinnedDownload(file, options.sha256!, 1_048_576, options.offline) : readFileSync(path);
  if (content.length > 1_048_576 || (options.sha256 !== undefined && digest(content) !== options.sha256)) throw new CliError('integrity', 'Catalog integrity check failed.');
  const release = catalogSchema.parse(JSON.parse(content.toString('utf8')));
  const packages = [];
  for (const [name, entry] of Object.entries(release.packages)) {
    if (entry === undefined || (options.packages !== undefined && !options.packages.has(name))) continue;
    const data = remote ? await pinnedDownload(new URL(entry.file, path).href, entry.sha256, 67_108_864, options.offline) : readFileSync(resolve(dirname(path), entry.file));
    if (data.length > 67_108_864 || digest(data) !== entry.sha256) throw new CliError('integrity', `Package integrity check failed: ${name}.`);
    packages.push({ name, version: entry.version, data, path: `.choco/packages/${entry.sha256}.tgz` });
  }
  return { ...release, packages };
}
export function compatible(release: Awaited<ReturnType<typeof catalog>>, assets: readonly Requirements[]) {
  const supported = new Map(release.capabilities.map(item => [item.id, item.version]));
  for (const asset of assets) {
    if (asset.formatVersion !== release.format || asset.semanticsVersion !== release.semantics || asset.required.some(item => supported.get(item.id) !== item.version))
      throw new CliError('incompatible', 'This release cannot play every installed asset. Supply a release supporting the complete set, or migrate the assets together.');
  }
}
