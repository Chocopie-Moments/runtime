import type { Score } from '../format/scoreTypes.ts';
import type { Scene, SceneNode } from '../format/sceneTypes.ts';
import type { ChocoMotion } from './codec.ts';
import { AMBIENT_KINDS, BEAT_KINDS, FOLLOW_MODES } from '../format/scoreTypes.ts';

/** Each identifier denotes the complete version-1 semantics, including its validated parameters. */
export const CHOCO_CAPABILITIES: ReadonlySet<string> = new Set([
  'scene.affine',
  'scene.palette',
  'scene.visibility',
  'scene.clip.evenodd',
  'scene.gradient.repeat',
  'scene.gradient.reflect',
  'scene.stroke.dashes',
  'scene.opacity',
  'motion.score',
  'motion.states',
  'motion.look',
  'motion.attach',
  'motion.pivots',
  'motion.hidden',
  'motion.strength',
  'motion.speed',
  'motion.reactions',
  'scene.path', 'scene.clip', 'scene.linear', 'scene.radial',
  ...AMBIENT_KINDS.map((kind) => `ambient.${kind}`),
  ...BEAT_KINDS.map((kind) => `beat.${kind}`),
  ...FOLLOW_MODES.map((kind) => `follow.${kind}`),
]);

export type Capability = { readonly id: string; readonly version: number };

/** The requirements come from validated content, never from a caller-supplied feature list. */
function drawingCapabilities(node: SceneNode, used: Set<string>) {
  if (node.transform.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index])) used.add('scene.affine');
  if (node.opacity !== 1) used.add('scene.opacity');
  if (node.shape !== undefined) {
    used.add('scene.path');
    if (node.shape.dasharray.length > 0 || node.shape.dashoffset !== 0) used.add('scene.stroke.dashes');
    if (node.shape.fillRule === 'evenodd') used.add('scene.clip.evenodd');
    for (const paint of [node.shape.fill, node.shape.stroke]) {
      if (paint.kind === 'linear' || paint.kind === 'radial') {
        used.add(`scene.${paint.kind}`);
        if (paint.spread !== 'pad') used.add(`scene.gradient.${paint.spread}`);
        if (paint.stops.some(stop => stop.rgba[3] !== 1)) used.add('scene.opacity');
      } else if (paint.kind === 'color' && paint.rgba[3] !== 1) used.add('scene.opacity');
    }
  }
  for (const child of node.children) drawingCapabilities(child, used);
  if (node.clip !== undefined) { used.add('scene.clip'); drawingCapabilities(node.clip, used); }
}

function scoreSettings(score: Score, used: Set<string>) {
  used.add('motion.score');
  if (Object.keys(score.states ?? {}).length) used.add('motion.states');
  if (score.look) used.add('motion.look');
  if (Object.keys(score.attach ?? {}).length) used.add('motion.attach');
  if (Object.keys(score.pivots ?? {}).length) used.add('motion.pivots');
  if (score.hidden?.length) used.add('motion.hidden');
  if (score.liveliness !== undefined || score.partGain !== undefined) used.add('motion.strength');
  if (score.speed !== undefined) used.add('motion.speed');
  if (score.enter || score.hover || score.click) used.add('motion.reactions');
}

function scoreCapabilities(score: Score, used: Set<string>) {
  scoreSettings(score, used);
  const states = Object.values(score.states ?? {});
  for (const ambient of [
    ...(score.ambient ?? []),
    ...states.flatMap((state) => state.ambient ?? []),
  ])
    used.add(`ambient.${ambient.do}`);
  for (const sequence of [
    score.enter,
    score.hover,
    score.click,
    ...states.map((state) => state.enter),
  ])
    for (const beat of sequence?.beats ?? []) used.add(`beat.${beat.do}`);
  for (const follow of score.follow ?? []) used.add(`follow.${follow.mode ?? 'pendulum'}`);
}

export function requiredCapabilities(scene: Scene, motion: ChocoMotion): Capability[] {
  const used = new Set<string>(['scene.palette', 'scene.visibility']);
  drawingCapabilities(scene.root, used);
  scoreCapabilities(motion.score, used);
  return [...used].sort().map((id) => ({ id, version: 1 }));
}

export function assertCapabilities(
  required: readonly Capability[],
  supported: ReadonlySet<string>,
) {
  const missing = required.filter(({ id, version }) => version !== 1 || !supported.has(id));
  if (missing.length)
    throw new Error(
      `This runtime cannot play: ${missing.map(({ id, version }) => `${id}@${version}`).join(', ')}.`,
    );
}
