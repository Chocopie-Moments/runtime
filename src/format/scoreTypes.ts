import type { Point } from './math.ts';
export const EASES = ['snap', 'sine', 'linear', 'in', 'out', 'inOut', 'back', 'spring', 'soft'] as const;
export type Ease = (typeof EASES)[number];
export const LOOP_WINDOW = 12;

export const AMBIENT_KINDS = [
  'keys',
  'float',
  'bob',
  'sway',
  'drift',
  'breathe',
  'pulse',
  'spin',
  'orbit',
  'flicker',
  'blink',
  'twinkle',
  'stream',
  'bounce',
] as const;
export type AmbientKind = (typeof AMBIENT_KINDS)[number];
/** Behaviors that act on each direct child of the part, staggered. */
export const CHILD_BEHAVIORS: ReadonlySet<AmbientKind> = new Set(['twinkle', 'stream', 'bounce']);

export const ENTRANCES = ['pop', 'drop', 'rise', 'slideIn', 'fadeIn', 'grow', 'unfold'] as const;
export type EntranceKind = (typeof ENTRANCES)[number];
export const EFFECTS = ['wave', 'wiggle', 'shake', 'nod', 'hop', 'squash', 'pulse', 'spin', 'lift'] as const;
export type EffectKind = (typeof EFFECTS)[number];
export const MOVES = ['to', 'travel', 'show', 'hide', 'fadeOut'] as const;
export const EMITTERS = ['burst', 'flow', 'drawOn', 'drawOff'] as const;
export const BEAT_KINDS = [...ENTRANCES, ...MOVES, ...EFFECTS, ...EMITTERS] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];
export const PARTICLE_SHAPES = ['circle', 'rect', 'star'] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];
export const FOLLOW_MODES = ['pendulum', 'lean', 'stretch'] as const;
export type FollowMode = (typeof FOLLOW_MODES)[number];
export const PALETTE_ROLES = ['accent', 'secondary', 'ink', 'background'] as const;

export type PoseInput = {
  readonly x?: number;
  readonly y?: number;
  readonly rotate?: number;
  readonly scale?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly opacity?: number;
};
export type Key = PoseInput & { readonly t: number; readonly ease?: Ease };

export type Ambient = {
  readonly do: AmbientKind;
  readonly part: string;
  readonly period?: number;
  readonly phase?: number;
  readonly x?: number;
  readonly y?: number;
  readonly deg?: number;
  readonly amount?: number;
  readonly fade?: number;
  readonly min?: number;
  readonly dim?: number;
  readonly dx?: number;
  readonly dy?: number;
  readonly stagger?: number;
  readonly reverse?: boolean;
  readonly keys?: readonly Key[];
};

export type Beat = {
  readonly do: BeatKind;
  readonly part?: string;
  readonly at?: number;
  readonly dur?: number;
  readonly ease?: Ease;
  readonly height?: number;
  readonly deg?: number;
  readonly times?: number;
  readonly px?: number;
  readonly amount?: number;
  readonly squash?: number;
  readonly turns?: number;
  readonly y?: number;
  readonly from?: Point;
  readonly points?: readonly Point[];
  readonly turn?: number;
  readonly pose?: PoseInput;
  readonly count?: number;
  readonly colors?: readonly string[];
  readonly shapes?: readonly ParticleShape[];
  readonly distance?: number;
  readonly spread?: number;
  readonly angle?: number;
  readonly gravity?: number;
  readonly size?: number;
  readonly stagger?: number;
  readonly endScale?: number;
  readonly seed?: number;
};
export type Sequence = { readonly beats: readonly Beat[] };

export type Follow = {
  readonly part: string;
  readonly mode?: FollowMode;
  readonly period?: number;
  readonly damping?: number;
  readonly gain?: number;
  readonly drag?: number;
  readonly amount?: number;
  readonly max?: number;
  readonly gainX?: number;
  readonly gainY?: number;
};

export type AppState = {
  readonly name?: string;
  readonly enter?: Sequence | null;
  readonly ambient?: readonly Ambient[];
};

export type Score = {
  readonly pivots?: Readonly<Record<string, Point>>;
  readonly attach?: Readonly<Record<string, string>>;
  readonly hidden?: readonly string[];
  readonly ambient?: readonly Ambient[];
  readonly follow?: readonly Follow[];
  readonly enter?: Sequence | null;
  readonly hover?: Sequence | null;
  readonly click?: Sequence | null;
  readonly look?: { readonly parts: readonly string[]; readonly range?: number } | null;
  readonly states?: Readonly<Record<string, AppState>>;
  readonly initialState?: string | null;
  /** Per-part playback strength. */
  readonly partGain?: Readonly<Record<string, number>>;
  /** Motion strength: 0 is still, 1 is full authored strength. */
  readonly liveliness?: number;
  /** Playback speed: 0.5 is half speed, 2 is double. */
  readonly speed?: number;
};

/** A box in scene coordinates: x, y, width, height. */
export type RigBox = readonly [number, number, number, number];
export type RigPart = {
  readonly id: string;
  readonly name?: string;
  /** The nearest named ancestor in the drawing, if any. */
  readonly parent: string | null;
  readonly box: RigBox;
  readonly background?: boolean;
  /** Direct children a child behavior can act on, in drawing order, with their boxes. */
  readonly children?: readonly RigBox[];
};
/** The drawing's named parts as the score sees them. */
export type Rig = { readonly width: number; readonly height: number; readonly parts: readonly RigPart[] };

/** The id a child behavior gives a part's nth direct child. */
export const childId = (part: string, index: number) => `${part}__c${index}`;

