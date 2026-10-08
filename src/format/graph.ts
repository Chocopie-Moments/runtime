import type { Score } from './scoreTypes.ts';

/** Exact handles the score addresses, including child indices. */
export function scoreTargets(score: Score): Set<string> {
  const refs = new Set<string>();
  const add = (part: string | undefined) => {
    if (part !== undefined) refs.add(part);
  };
  const beats = [score.enter, score.hover, score.click, ...Object.values(score.states ?? {}).map((state) => state.enter)];
  for (const b of [...(score.ambient ?? []), ...Object.values(score.states ?? {}).flatMap((state) => state.ambient ?? [])]) add(b.part);
  for (const sequence of beats) for (const b of sequence?.beats ?? []) add(b.part);
  for (const f of score.follow ?? []) add(f.part);
  for (const part of [...Object.keys(score.pivots ?? {}), ...Object.keys(score.partGain ?? {}), ...Object.entries(score.attach ?? {}).flat(), ...(score.hidden ?? []), ...(score.look?.parts ?? [])]) add(part);
  return refs;
}


/** Complete outermost-first carrier chains. Reject cycles rather than truncating their motion. */
export function carrierChains(
  parents: ReadonlyMap<string, string | null>,
): Map<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>();
  const visiting = new Set<string>();
  const chain = (part: string): readonly string[] => {
    const known = chains.get(part);
    if (known !== undefined) return known;
    if (visiting.has(part)) throw new Error(`Motion attachments contain a cycle at ${part}.`);
    const parent = parents.get(part);
    if (parent === undefined) throw new Error(`Unknown motion carrier: ${part}.`);
    visiting.add(part);
    const result = parent === null ? [] : [...chain(parent), parent];
    visiting.delete(part);
    chains.set(part, result);
    return result;
  };
  for (const part of parents.keys()) chain(part);
  return chains;
}

/** The same graph contract applies to compiled scene handles without parsing SVG. */
export function assertScoreGraph(score: Score, parents: Map<string, string | null>) {
  for (const target of scoreTargets(score)) {
    if (!parents.has(target)) throw new Error(`Unknown motion target: ${target}.`);
  }
  for (const [child, parent] of Object.entries(score.attach ?? {})) {
    if (!parents.has(child)) throw new Error(`Unknown motion part: ${child}.`);
    parents.set(child, parent);
  }
  carrierChains(parents);
  if (Object.values(score.states ?? {}).some(state => state.name !== undefined && (state.name.trim().length === 0 || state.name.length > 60))) throw new Error('State names cannot be blank.');
  const states = new Set(Object.keys(score.states ?? {}));
  for (const id of ['idle', 'enter', 'hover', 'click']) {
    if (states.has(id))
      throw new Error(`The app state name ${id} is reserved for playback controls.`);
  }
  if (score.initialState !== undefined && score.initialState !== null && !states.has(score.initialState))
    throw new Error(`Unknown starting state: ${score.initialState}.`);
}
