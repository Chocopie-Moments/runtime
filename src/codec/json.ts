function stringEnd(source: string, start: number): number {
  let at = start;
  for (; at < source.length && source[at] !== '"'; at++) if (source[at] === '\\') at++;
  if (at >= source.length) throw new Error('Unterminated .choco JSON string.');
  return at;
}
/** JSON escapes must represent Unicode scalar values, as the native UTF-8 reader requires. */
export function assertUnicode(value: string): void {
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++at);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Unpaired .choco Unicode surrogate.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Unpaired .choco Unicode surrogate.');
  }
}
/** Reject ambiguous keys and excessive nesting before the platform JSON parser allocates a tree. */
export function readJson(bytes: Uint8Array): unknown {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const stack: { keys: Set<string> | null; key: boolean }[] = [];
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (char === '"') {
      const start = at++;
      at = stringEnd(source, at);
      const value: unknown = JSON.parse(source.slice(start, at + 1));
      if (typeof value !== 'string') throw new Error('Invalid .choco JSON string.');
      assertUnicode(value);
      const parent = stack.at(-1);
      if (parent?.key && parent.keys !== null) {
        if (parent.keys.has(value)) throw new Error('Duplicate .choco JSON key.');
        parent.keys.add(value);
      }
    } else if (char === '{' || char === '[') {
      if (stack.length >= 96) throw new Error('.choco JSON nesting exceeds 96.');
      stack.push({ keys: char === '{' ? new Set() : null, key: char === '{' });
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ':' || char === ',') {
      const parent = stack.at(-1);
      if (parent !== undefined) parent.key = char === ',' && parent.keys !== null;
    }
  }
  return JSON.parse(source);
}

/** Finite validated data only; object key order is canonical, array order remains semantic. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => {
    assertUnicode(key);
    if (typeof item === 'string') assertUnicode(item);
    if (item !== null && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : Number(a > b)));
    return item;
  });
}
