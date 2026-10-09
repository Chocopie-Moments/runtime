import { z } from 'zod';
import { CHOCO_LIMITS } from '../../../src/codec/archive.ts';
import { pinnedDownload } from './catalog.ts';
import { CliError } from './files.ts';

/** A Chocopie export id, as Use shows it: the moment's slug and its random capability. */
export const MOMENT_ID = /^[a-z0-9-]+-[\w-]{16,64}$/;
const ORIGIN = 'https://app.chocopie.lol';
const https = z.string().url().refine(value => new URL(value).protocol === 'https:', 'Expected HTTPS.');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** What Chocopie answers for an id. Unknown fields are ignored so the service can add some. */
const resolutionSchema = z.object({
  format: z.literal('chocopie-install'),
  version: z.literal(1),
  id: z.string(),
  name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  asset: z.object({ url: https, sha256 }),
  catalog: z.object({ url: https, sha256 }),
});
export type Resolved = { name: string; data: Buffer; catalog: { url: string; sha256: string } };

/** CHOCOPIE_ORIGIN points the CLI at another Chocopie deployment; it must still be HTTPS. */
function origin() {
  const value = process.env.CHOCOPIE_ORIGIN ?? ORIGIN;
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url?.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new CliError('source', 'CHOCOPIE_ORIGIN must be an HTTPS origin such as https://app.chocopie.lol.');
  return url.origin;
}

/**
 * Turns an id into the exact frozen asset, its name and the release catalog that installs it. The
 * asset and catalog stay pinned by SHA-256: the service names them, it does not vouch for bytes.
 */
export async function resolveMoment(id: string, offline = false): Promise<Resolved> {
  if (offline) throw new CliError('offline', 'A moment id needs Chocopie. In offline mode, supply a local .choco file.');
  const response = await fetch(`${origin()}/r/${encodeURIComponent(id)}/install`, {
    redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new CliError('source', 'Chocopie could not be reached. Check your connection and try again.'); });
  const text = await response.text();
  if (text.length > 65_536) throw new CliError('source', 'Chocopie answered with more than a moment’s install details.');
  const body: unknown = (() => { try { return JSON.parse(text); } catch { return undefined; } })();
  if (response.status === 404) throw new CliError('not_found', 'No Chocopie moment has this id. Copy the command again from Use in Chocopie.');
  if (!response.ok) {
    const message = z.object({ error: z.string().max(300) }).safeParse(body);
    throw new CliError('unavailable', message.success ? message.data.error : `Chocopie could not resolve this moment (HTTP ${response.status}). Try again.`);
  }
  const parsed = resolutionSchema.safeParse(body);
  if (!parsed.success || parsed.data.id !== id) throw new CliError('source', 'Chocopie’s answer for this id was not a valid install description.');
  const { name, asset, catalog } = parsed.data;
  return { name, catalog, data: await pinnedDownload(asset.url, asset.sha256, CHOCO_LIMITS.compressed) };
}
