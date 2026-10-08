import { CHOCO_LIMITS } from './archive.ts';

/** Fetch only inert bytes. The caller still has to decode and validate them before use. */
export async function fetchChoco(source: string | URL, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(source, { signal, credentials: 'omit' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Could not load .choco (${response.status}).`);
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > CHOCO_LIMITS.compressed) {
    await response.body?.cancel();
    throw new Error('The .choco download exceeds the byte limit.');
  }
  if (response.body === null) throw new Error('The .choco download is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > CHOCO_LIMITS.compressed)
        throw new Error('The .choco download exceeds the byte limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
