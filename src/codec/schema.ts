/** Build-time schema owner; installed apps use the generated validators. */
import { z } from 'zod';
import { PALETTE_ROLES } from '../format/scoreTypes.ts';
const svgIdSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const paletteSchema = z.object({ accent: color, secondary: color, ink: color, background: color }).strict();
// Descriptive metadata, never a renderer feature or a closed product taxonomy.
const category = z.string().min(1).max(80);
import { scoreSchema } from '../format/scoreSchema.ts';
import type { SceneNode } from '../format/sceneTypes.ts';

const coordinate = z.number().min(-1_000_000).max(1_000_000);
const unit = z.number().min(0).max(1);
const positive = z.number().positive().max(1_000_000);
const point = z.tuple([coordinate, coordinate]);
const matrix = z.tuple([coordinate, coordinate, coordinate, coordinate, coordinate, coordinate]);
const rgba = z.tuple([unit, unit, unit, unit]);
const role = z.enum(PALETTE_ROLES).optional();
const stop = z.object({ offset: unit, rgba, role }).strict();
const gradient = { transform: matrix, spread: z.enum(['pad', 'repeat', 'reflect']), stops: z.array(stop).min(1).max(256) };
const paint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('color'), rgba, role }).strict(),
  z.object({ kind: z.literal('linear'), ...gradient, values: z.tuple([coordinate, coordinate, coordinate, coordinate]) }).strict(),
  z.object({ kind: z.literal('radial'), ...gradient, values: z.tuple([coordinate, coordinate, positive, coordinate, coordinate]) }).strict(),
]);
const contour = z.object({ start: point, closed: z.boolean(), segments: z.array(z.object({ c1: point, c2: point, to: point, line: z.boolean() }).strict()).max(200_000) }).strict();
const shapeSchema = z.object({
  contours: z.array(contour).max(200_000), fill: paint, stroke: paint,
  fillRule: z.enum(['nonzero', 'evenodd']), strokeWidth: z.number().min(0).max(1_000_000),
  linecap: z.enum(['butt', 'round', 'square']), linejoin: z.enum(['miter', 'round', 'bevel']),
  miterlimit: z.number().min(1).max(1_000_000), dasharray: z.array(z.number().min(0).max(1_000_000)).max(256), dashoffset: coordinate,
}).strict();
// Generated child handles can exceed the 80-character authoring ID limit by their suffix.
const handle = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,89}$/);
const node: z.ZodType<SceneNode> = z.lazy(() => z.object({
  bindings: z.array(handle).max(2).optional(), transform: matrix, opacity: unit,
  displayed: z.boolean(), visible: z.boolean(),
  part: z.object({ id: svgIdSchema, name: z.string().min(1).max(100), background: z.boolean() }).strict().optional(),
  shape: shapeSchema.optional(), clip: node.optional(), children: z.array(node).max(10_000),
}).strict());
export const sceneSchema = z.object({ viewBox: z.tuple([coordinate, coordinate, positive, positive]), root: node }).strict();
const box = z.tuple([coordinate, coordinate, z.number().min(0).max(1_000_000), z.number().min(0).max(1_000_000)]);
export const rigSchema = z.object({ width: positive, height: positive, parts: z.array(z.object({
  id: svgIdSchema, name: z.string().max(100).optional(), parent: svgIdSchema.nullable(), box,
  background: z.boolean().optional(), children: z.array(box).max(1800).optional(),
}).strict()).max(100) }).strict();
export type CompiledScene = z.infer<typeof sceneSchema>;
export type CompiledRig = z.infer<typeof rigSchema>;

/** Development revision 2. Public format 1 remains reserved for the certified release. */
import { CHOCO_FORMAT_VERSION, CHOCO_FORMAT_REVISION, CHOCO_SEMANTICS_VERSION } from './version.ts';
const fileSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(2_097_152) }).strict();
export const chocoManifestSchema = z.object({
  format: z.literal('choco'), formatVersion: z.literal(CHOCO_FORMAT_VERSION), formatRevision: z.literal(CHOCO_FORMAT_REVISION),
  semanticsVersion: z.literal(CHOCO_SEMANTICS_VERSION),
  name: z.string().min(1).max(80), kind: category, palette: paletteSchema,
  states: z.array(svgIdSchema).min(1).max(256),
  required: z.array(z.object({ id: z.string().min(1).max(100), version: z.number().int().positive() }).strict()).max(128),
  files: z.object({ 'scene.json': fileSchema, 'motion.json': fileSchema, 'ATTRIBUTION.txt': fileSchema.optional() }).strict(),
}).strict();
export type ChocoManifest = z.infer<typeof chocoManifestSchema>;
export const chocoMotionSchema = z.object({ kind: z.literal('score'), rig: rigSchema, score: scoreSchema }).strict();
export type ChocoMotion = z.infer<typeof chocoMotionSchema>;
export const chocoDocumentSchema = z.object({ name: z.string().min(1).max(80), kind: category, palette: paletteSchema, scene: sceneSchema, motion: chocoMotionSchema }).strict();
export type ChocoDocument = z.infer<typeof chocoDocumentSchema>;

