/** Mutate only compressed bytes, preserving ZIP consistency and uncompressed hashes/CRC. */
export function changeFirstCompressedEntry(bytes: Uint8Array, change: (data: Uint8Array) => Uint8Array): Uint8Array {
  const original = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (original.getUint16(8, true) !== 8) throw new Error('Fixture requires DEFLATE.');
  const start = 30 + original.getUint16(26, true) + original.getUint16(28, true);
  const size = original.getUint32(18, true);
  const data = change(bytes.subarray(start, start + size));
  const delta = data.length - size;
  const result = new Uint8Array(bytes.length + delta);
  result.set(bytes.subarray(0, start));
  result.set(data, start);
  result.set(bytes.subarray(start + size), start + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(18, data.length, true);
  const end = result.length - 22;
  const directory = original.getUint32(bytes.length - 6, true) + delta;
  view.setUint32(end + 16, directory, true);
  for (let at = directory; at < end; at += 46 + view.getUint16(at + 28, true)) {
    const offset = view.getUint32(at + 42, true);
    if (offset === 0) view.setUint32(at + 20, data.length, true);
    else view.setUint32(at + 42, offset + delta, true);
  }
  return result;
}
