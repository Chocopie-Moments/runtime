import { strToU8, zipSync } from 'fflate';
import { Inflate } from 'pako/lib/inflate.js';

/** Draft .choco uses a bounded ZIP32 subset: three data entries and optional attribution. */
export const CHOCO_LIMITS = { compressed: 1_048_576, expanded: 2_097_152, entries: 4 } as const;
const NAMES = new Set(['manifest.json', 'scene.json', 'motion.json', 'ATTRIBUTION.txt']);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Stable entry order and ZIP timestamps; compression is pinned to fflate by package-lock. */
export function writeArchive(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries = [...files].sort(([a], [b]) => (a < b ? -1 : Number(a > b)));
  if (entries.length > CHOCO_LIMITS.entries || entries.some(([name]) => !NAMES.has(name)))
    throw new Error('Unsupported .choco archive entry.');
  if (entries.reduce((n, [, bytes]) => n + bytes.length, 0) > CHOCO_LIMITS.expanded)
    throw new Error('The .choco contents exceed the expanded byte limit.');
  const bytes = zipSync(Object.fromEntries(entries), { level: 6, mtime: new Date(1980, 0, 1) });
  if (bytes.length > CHOCO_LIMITS.compressed)
    throw new Error('The .choco file exceeds the compressed byte limit.');
  return bytes;
}

/**
 * Check directory/local-header agreement before inflation. No ZIP64, streaming descriptors,
 * encryption, extra entries or paths. Inflate in small chunks and check actual output as well
 * as advertised sizes, so a forged directory cannot allocate an unbounded buffer.
 */
const invalid = () => new Error('Invalid or unsupported .choco ZIP archive.');
type Entry = {
  name: string;
  offset: number;
  size: number;
  expanded: number;
  crc: number;
  method: number;
  flags: number;
};

function inflateEntry(entry: Entry, compressed: Uint8Array): Uint8Array {
  const output = new Uint8Array(entry.expanded);
  let written = 0;
  if (entry.method === 0) {
    if (entry.size !== entry.expanded) throw invalid();
    output.set(compressed);
    written = output.length;
  } else {
    const inflate = new Inflate({ raw: true, chunkSize: 16_384 });
    inflate.onData = (chunk) => {
      if (written + chunk.length > output.length) throw invalid();
      output.set(chunk, written);
      written += chunk.length;
    };
    // Reserve the final byte. If the stream ended earlier, this last push fails,
    // including when trailing data was hidden within the preceding chunk. This
    // uses the public stream contract, not inflater-internal cursor fields.
    const last = compressed.length - 1;
    for (let pos = 0; pos < last; pos += 1024)
      if (!inflate.push(compressed.subarray(pos, Math.min(pos + 1024, last)), false)) throw invalid();
    if (last < 0 || !inflate.push(compressed.subarray(last), true)) throw invalid();
  }
  if (written !== output.length || crc32(output) !== entry.crc) throw invalid();
  return output;
}

function readDirectory(bytes: Uint8Array, view: DataView, directory: number, count: number) {
  const end = bytes.length - 22;
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const entries: Entry[] = [];
  const names = new Set<string>();
  let at = directory;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw invalid();
    const flags = u16(at + 8),
      method = u16(at + 10),
      nameLength = u16(at + 28);
    if (
      ![0, 0x800].includes(flags) ||
      ![0, 8].includes(method) ||
      [30, 32, 34].some((field) => u16(at + field) !== 0) ||
      at + 46 + nameLength > end
    )
      throw invalid();
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (!NAMES.has(name) || names.has(name)) throw invalid();
    names.add(name);
    const expanded = u32(at + 24);
    total += expanded;
    if (total > CHOCO_LIMITS.expanded) throw invalid();
    entries.push({
      name,
      offset: u32(at + 42),
      size: u32(at + 20),
      expanded,
      crc: u32(at + 16),
      method,
      flags,
    });
    at += 46 + nameLength;
  }
  if (at !== end || !['manifest.json', 'scene.json', 'motion.json'].every((name) => names.has(name)))
    throw invalid();
  return entries.sort((a, b) => a.offset - b.offset);
}

function entryData(bytes: Uint8Array, view: DataView, entry: Entry, directory: number) {
  const u16 = (at: number) => view.getUint16(entry.offset + at, true);
  const u32 = (at: number) => view.getUint32(entry.offset + at, true);
  if (entry.offset + 30 > directory || u32(0) !== 0x04034b50) throw invalid();
  const nameLength = strToU8(entry.name).length;
  const start = entry.offset + 30 + nameLength;
  if (
    u16(6) !== entry.flags ||
    u16(8) !== entry.method ||
    u32(14) !== entry.crc ||
    u32(18) !== entry.size ||
    u32(22) !== entry.expanded ||
    u16(26) !== nameLength ||
    u16(28) !== 0 ||
    start + entry.size > directory ||
    utf8.decode(bytes.subarray(entry.offset + 30, start)) !== entry.name
  )
    throw invalid();
  return { data: bytes.subarray(start, start + entry.size), next: start + entry.size };
}

export function readArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22 || bytes.length > CHOCO_LIMITS.compressed) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || [4, 6, 20].some((field) => u16(end + field) !== 0))
    throw invalid();
  const count = u16(end + 10),
    directory = u32(end + 16);
  if (
    count < 3 ||
    count > CHOCO_LIMITS.entries ||
    u16(end + 8) !== count ||
    directory + u32(end + 12) !== end
  )
    throw invalid();
  const entries = readDirectory(bytes, view, directory, count);
  const files = new Map<string, Uint8Array>();
  let next = 0;
  for (const entry of entries) {
    if (entry.offset !== next) throw invalid();
    const content = entryData(bytes, view, entry, directory);
    next = content.next;
    files.set(entry.name, inflateEntry(entry, content.data));
  }
  if (next !== directory) throw invalid();
  return files;
}
