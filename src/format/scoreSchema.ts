import { z } from 'zod';
import { EASES } from './scoreTypes.ts';
import { LOOP_WINDOW } from './scoreTypes.ts';
import {
  AMBIENT_KINDS,
  BEAT_KINDS,
  FOLLOW_MODES,
  PALETTE_ROLES,
  PARTICLE_SHAPES,
} from './scoreTypes.ts';

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const finite = z.number().finite().min(-4096).max(4096);
const point = z.tuple([finite, finite]);
const ease = z.enum(EASES);

const poseInput = {
  x: finite.optional(),
  y: finite.optional(),
  rotate: finite.optional(),
  scale: z.number().min(0.01).max(4).optional(),
  scaleX: z.number().min(0.01).max(4).optional(),
  scaleY: z.number().min(0.01).max(4).optional(),
  opacity: z.number().min(0).max(1).optional(),
};
const keySchema = z.object({ t: z.number().min(0).max(LOOP_WINDOW), ...poseInput, ease: ease.optional() }).strict();

export const ambientSchema = z
  .object({
    do: z.enum(AMBIENT_KINDS),
    part: id,
    period: z.number().positive().max(60).optional(),
    phase: z.number().min(-10).max(10).optional(),
    x: finite.optional(),
    y: finite.optional(),
    deg: finite.optional(),
    amount: z.number().min(0).max(10).optional(),
    fade: z.number().min(0).max(1).optional(),
    min: z.number().min(0).max(4).optional(),
    dim: z.number().min(0).max(1).optional(),
    dx: finite.optional(),
    dy: finite.optional(),
    stagger: z.number().min(0).max(10).optional(),
    reverse: z.boolean().optional(),
    keys: z.array(keySchema).max(16).optional(),
  })
  .strict();

export const beatSchema = z
  .object({
    do: z.enum(BEAT_KINDS),
    part: id.optional(),
    at: z.number().min(0).max(20).optional(),
    dur: z.number().min(0).max(10).optional(),
    ease: ease.optional(),
    height: finite.optional(),
    deg: finite.optional(),
    times: z.number().min(0).max(20).optional(),
    px: finite.optional(),
    amount: z.number().min(0).max(10).optional(),
    squash: z.number().min(0).max(1).optional(),
    turns: z.number().min(-10).max(10).optional(),
    y: finite.optional(),
    from: point.optional(),
    points: z.array(point).max(8).optional(),
    turn: finite.optional(),
    pose: z.object(poseInput).strict().optional(),
    count: z.number().int().min(0).max(64).optional(),
    colors: z
      .array(z.union([z.enum(PALETTE_ROLES), z.string().regex(/^#[0-9a-fA-F]{6}$/)]))
      .max(6)
      .optional(),
    shapes: z.array(z.enum(PARTICLE_SHAPES)).max(3).optional(),
    distance: finite.optional(),
    spread: z.number().min(0).max(360).optional(),
    angle: finite.optional(),
    gravity: finite.optional(),
    size: z.number().min(0).max(200).optional(),
    stagger: z.number().min(0).max(5).optional(),
    endScale: z.number().min(0).max(4).optional(),
    seed: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
const sequenceSchema = z.object({ beats: z.array(beatSchema).max(16) }).strict();

export const followSchema = z
  .object({
    part: id,
    mode: z.enum(FOLLOW_MODES).optional(),
    // The 240 Hz spring solver is stable at this floor even at the maximum damping.
    period: z.number().min(0.2).max(10).optional(),
    damping: z.number().min(0).max(5).optional(),
    gain: z.number().min(0).max(10).optional(),
    drag: z.number().min(0).max(20).optional(),
    amount: z.number().min(0).max(50).optional(),
    max: z.number().min(0).max(90).optional(),
    gainX: z.number().min(-1).max(1).optional(),
    gainY: z.number().min(-1).max(1).optional(),
  })
  .strict();

export const appStateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    enter: sequenceSchema.nullable().optional(),
    ambient: z.array(ambientSchema).max(8).optional(),
  })
  .strict();

export const scoreSchema = z
  .object({
    pivots: z.record(id, point).optional(),
    attach: z.record(id, id).optional(),
    hidden: z.array(id).max(32).optional(),
    ambient: z.array(ambientSchema).max(16).optional(),
    follow: z.array(followSchema).max(8).optional(),
    enter: sequenceSchema.nullable().optional(),
    hover: sequenceSchema.nullable().optional(),
    click: sequenceSchema.nullable().optional(),
    look: z
      .object({ parts: z.array(id).min(1).max(4), range: z.number().min(0).max(40).optional() })
      .strict()
      .nullable()
      .optional(),
    states: z.record(id, appStateSchema).optional(),
    initialState: id.nullable().optional(),
    partGain: z.record(id, z.number().min(0).max(2)).optional(),
    liveliness: z.number().min(0).max(1.5).optional(),
    speed: z.number().min(0.5).max(2).optional(),
  })
  .strict();

