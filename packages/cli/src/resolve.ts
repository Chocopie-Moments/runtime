import { z } from 'zod';
import { CHOCO_LIMITS } from '../../../src/codec/archive.ts';
import { retryDropped, loopback, pinnedDownload } from './catalog.ts';
import { CliError } from './files.ts';

/** A Chocopie install id, as Use shows it: the moment's slug and a random part. */
export const MOMENT_ID = /^[a-z0-9-]+-[\w-]{16,64}$/;
const ORIGIN = 'https://app.chocopie.lol';
/**
 * The only place a resolved catalog may come from: this repository's GitHub releases. Chocopie names
 * which release; it cannot point the CLI at packages published anywhere else.
 */
export const RELEASES = 'https://github.com/Chocopie-Moments/runtime/releases/download/';
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export type Resolved = { id: string; origin: string; name: string; app?: string; data: Buffer; catalog: { url: string; sha256: string } };

/**
 * CHOCOPIE_ORIGIN points the CLI at another Chocopie deployment over HTTPS, or at a development
 * server on this machine. Integrity never depends on it: every download is checked by hash.
 */
function origin() {
  const value = process.env.CHOCOPIE_ORIGIN ?? ORIGIN;
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url === undefined || !(url.protocol === 'https:' || loopback(url)) || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new CliError('source', 'CHOCOPIE_ORIGIN must be an HTTPS origin such as https://app.chocopie.lol, or a server on this machine.');
  return url;
}

/**
 * Turns an id into the exact frozen asset, its name and the release catalog that installs it. The
 * asset and catalog stay pinned by SHA-256: the service names them, it does not vouch for bytes.
 */
export async function resolveMoment(id: string, offline = false): Promise<Resolved> {
  if (offline) throw new CliError('offline', 'A moment id needs Chocopie. In offline mode, supply a local .choco file.');
  const base = origin();
  const local = loopback(base);
  const url = z.string().url().refine(value => new URL(value).protocol === 'https:' || (local && loopback(new URL(value))), 'Expected HTTPS.');
  const response = await retryDropped(() => fetch(new URL(`/r/${encodeURIComponent(id)}/install`, base), {
    redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
  })).catch(() => { throw new CliError('source', 'Chocopie could not be reached. Check your connection and try again.'); });
  const text = await bounded(response, 65_536);
  const body: unknown = (() => { try { return JSON.parse(text); } catch { return undefined; } })();
  if (response.status === 404) throw new CliError('not_found', 'No Chocopie moment has this id. Copy the command again from Use in Chocopie.');
  if (!response.ok) {
    const message = z.object({ error: z.string().max(300) }).safeParse(body);
    throw new CliError('unavailable', message.success ? message.data.error : `Chocopie could not resolve this moment (HTTP ${response.status}). Try again.`);
  }
  // Unknown fields are ignored so the service can add some.
  const parsed = z.object({
    format: z.literal('chocopie-install'), version: z.literal(1), id: z.literal(id),
    name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), app: z.string().min(1).max(80).optional(),
    asset: z.object({ url, sha256 }), catalog: z.object({ url: z.string().url().refine(value => value.startsWith(RELEASES)), sha256 }),
  }).safeParse(body);
  if (!parsed.success) throw new CliError('source', 'Chocopie’s answer for this id was not a valid install description.');
  const { name, app, asset, catalog } = parsed.data;
  return { id, origin: base.origin, name, app, catalog, data: await pinnedDownload(asset.url, asset.sha256, CHOCO_LIMITS.compressed, false, local) };
}

/**
 * Tells the moment's Use sheet where it was added. Only the project's name, the generated file and
 * the platform are sent. It never delays or fails an install: a report that cannot be sent is dropped.
 */
export async function reportAdded(moment: Resolved, added: { project: string; file: string; target: string }) {
  await fetch(new URL(`/r/${encodeURIComponent(moment.id)}/installed`, moment.origin), {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...added, project: added.project.slice(0, 80) }), signal: AbortSignal.timeout(3_000),
  }).then(response => response.body?.cancel()).catch(() => undefined);
}

/** Reads at most limit bytes of an answer, so a wrong server cannot make the CLI hold more. */
async function bounded(response: Response, limit: number) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader?.read();
      if (next === undefined || next.done) break;
      length += next.value.length;
      if (length > limit) throw new CliError('source', 'Chocopie answered with more than a moment’s install details.');
      chunks.push(next.value);
    }
  } finally { await reader?.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString('utf8');
}
