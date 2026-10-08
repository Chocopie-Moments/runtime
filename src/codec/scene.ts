import type { CompiledScene, CompiledRig, ChocoMotion } from './schema.ts';
/** Compiled drawing contract. Playback accepts geometry, never SVG, fonts, CSS or external resources. */
import type { SceneNode, SceneShape } from '../format/sceneTypes.ts';
import { childId } from '../format/scoreTypes.ts';
import { multiply, IDENTITY } from '../format/math.ts';
import type { Matrix } from '../format/math.ts';
import { carrierChains } from '../format/graph.ts';

function assertShape(shape: SceneShape, budget: { segments: number; contours: number; stops: number }) {
  budget.contours += shape.contours.length;
  for (const path of shape.contours) budget.segments += path.segments.length;
  if (budget.contours > 200_000 || budget.segments > 200_000) throw new Error('Scene path budget exceeded.');
  if (shape.dasharray.length > 0 && !shape.dasharray.some(value => value > 0)) throw new Error('A dash pattern must contain a positive length.');
  for (const fill of [shape.fill, shape.stroke]) {
    if (fill.kind !== 'linear' && fill.kind !== 'radial') continue;
    budget.stops += fill.stops.length;
    if (budget.stops > 8192 || fill.stops.some((color, i) => i > 0 && color.offset < fill.stops[i - 1].offset)) throw new Error('Invalid gradient stops or gradient budget exceeded.');
  }
}

function assertBindings(at: SceneNode, mask: boolean, parents: ReadonlyMap<string, string | null>, seen: { found: Set<string>; named: Set<string> }) {
  const { found, named } = seen;
    for (const id of at.bindings ?? []) {
      if (mask || !parents.has(id) || found.has(id)) throw new Error(`Invalid scene motion binding: ${id}.`);
      found.add(id);
    }
    if (at.part !== undefined) {
    if (at.part.name.length > 100) throw new Error('The scene part name exceeds 100 code units.');
      if (mask || named.has(at.part.id) || !at.bindings?.includes(at.part.id)) throw new Error('Invalid named scene part.');
      named.add(at.part.id);
    }
 }

/** Cross references and cumulative budgets, in addition to the local JSON schema. */
export function assertScene(scene: CompiledScene, rig: CompiledRig): Map<string, string | null> {
  if (scene.viewBox[2] !== rig.width || scene.viewBox[3] !== rig.height) throw new Error('Scene and rig dimensions differ.');
  const parents = new Map<string, string | null>();
  for (const part of rig.parts) {
    if ((part.name?.length ?? 0) > 100) throw new Error('The rig part name exceeds 100 code units.');
    if (parents.has(part.id)) throw new Error(`Duplicate motion handle: ${part.id}.`);
    parents.set(part.id, part.parent);
  }
  for (const part of rig.parts) {
    if (part.parent !== null && !parents.has(part.parent)) throw new Error(`Unknown rig parent: ${part.parent}.`);
    for (let index = 0; index < (part.children?.length ?? 0); index++) {
      const id = childId(part.id, index);
      if (parents.has(id)) throw new Error(`Duplicate motion handle: ${id}.`);
      parents.set(id, part.id);
    }
  }
  if (parents.size > 2048) throw new Error('Scene motion handle budget exceeded.');
  carrierChains(parents);
  const found = new Set<string>();
  const named = new Set<string>();
  let count = 0;
  const budget = { segments: 0, contours: 0, stops: 0 };
  const walk = (at: SceneNode, depth: number, parent: Matrix, mask: boolean) => {
    if (++count > 10_000 || depth > 32) throw new Error('Scene node/depth limit exceeded.');
    const world = multiply(parent, at.transform);
    if (world.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new Error('Scene world transform exceeds the numeric budget.');
    if ((at.bindings?.length ?? 0) > 0 && Math.abs(parent[0] * parent[3] - parent[1] * parent[2]) < 1e-12)
      throw new Error('An animated parent transform is singular.');
    assertBindings(at, mask, parents, { found, named });
    if (at.shape !== undefined) assertShape(at.shape, budget);
    for (const child of at.children) walk(child, depth + 1, world, mask);
    if (at.clip !== undefined) walk(at.clip, depth + 1, world, true);
  };
  walk(scene.root, 0, IDENTITY, false);
  if (found.size !== parents.size || rig.parts.some(part => !named.has(part.id))) throw new Error('The scene does not bind every rig handle.');
  return parents;
}

/** Bound copies in every state before admitting an asset, including states not entered yet. */
export function assertFlowBudget(scene: CompiledScene, score: ChocoMotion['score']) {
  const capacities = new Map<string, number>();
  const groups = [[score.enter, score.hover, score.click], Object.values(score.states ?? {}).map(state => state.enter)];
  for (const sequences of groups) {
    const maximum = new Map<string, number>();
    for (const sequence of sequences) {
      const counts = new Map<string, number>();
      for (const beat of sequence?.beats ?? []) {
        if (beat.do !== 'flow' || beat.part === undefined) continue;
        counts.set(beat.part, (counts.get(beat.part) ?? 0) + Math.max(1, Math.min(12, beat.count ?? 3)));
      }
      for (const [part, count] of counts) maximum.set(part, Math.max(maximum.get(part) ?? 0, count));
    }
    for (const [part, count] of maximum) capacities.set(part, (capacities.get(part) ?? 0) + count);
  }
  if (capacities.size === 0) return;
  let paints = 0, segments = 0, stops = 0;
  const cost = (node: SceneNode): { paints: number; segments: number; stops: number } => {
    const result = { paints: node.shape === undefined ? 1 : 2, segments: node.shape?.contours.reduce((sum, contour) => sum + contour.segments.length + 1, 0) ?? 0, stops: 0 };
    if (node.shape !== undefined) for (const paint of [node.shape.fill, node.shape.stroke]) {
      if (paint.kind === 'linear' || paint.kind === 'radial') result.stops += paint.stops.length;
    }
    for (const child of [...node.children, ...(node.clip === undefined ? [] : [node.clip])]) {
      const next = cost(child); result.paints += next.paints; result.segments += next.segments; result.stops += next.stops;
    }
    return result;
  };
  const visit = (node: SceneNode) => {
    const count = (node.bindings ?? []).reduce((sum, id) => sum + (capacities.get(id) ?? 0), 0);
    if (count > 0) {
      const geometry = cost(node);
      paints += 2 + count * (geometry.paints + 1);
      segments += count * geometry.segments;
      stops += count * geometry.stops;
      if (paints > 10_000 || segments > 200_000 || stops > 8192) throw new Error('Flow copies exceed the retained geometry budget (10000 paints / 200000 segments / 8192 stops).');
    }
    for (const child of node.children) visit(child);
  };
  visit(scene.root);
}
