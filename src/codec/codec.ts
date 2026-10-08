import { strToU8 } from 'fflate';
import { assertScoreGraph } from '../format/graph.ts';
import { readArchive, writeArchive } from './archive.ts';
import { assertCapabilities, CHOCO_CAPABILITIES, requiredCapabilities } from './capabilities.ts';
import { assertFlowBudget, assertScene } from './scene.ts';
import { assertUnicode, canonicalJson, readJson } from './json.ts';

import { CHOCO_FORMAT_VERSION, CHOCO_FORMAT_REVISION, CHOCO_SEMANTICS_VERSION } from './version.ts';
export { CHOCO_FORMAT_VERSION, CHOCO_FORMAT_REVISION, CHOCO_SEMANTICS_VERSION } from './version.ts';
import { validateDocument, validateManifest } from './generated/validate.js';
import type { ChocoDocument, ChocoMotion } from './schema.ts';
export type { ChocoDocument, ChocoManifest, ChocoMotion } from './schema.ts';

export async function chocoDigest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function stateIds(motion: ChocoMotion) {
  return ['idle', ...Object.keys(motion.score.states ?? {}), ...(['enter', 'hover', 'click'] as const).filter(id => (motion.score[id]?.beats.length ?? 0) > 0)].sort();
}
export function validateChocoDocument(value: unknown): ChocoDocument {
  const document: unknown = structuredClone(value);
  if (!validateDocument(document)) throw new Error('Invalid .choco scene or motion schema.');
  if (document.name.length > 80) throw new Error('The .choco name exceeds 80 code units.');
  const { scene, motion } = document;
  const parents = assertScene(scene, motion.rig);
  assertScoreGraph(motion.score, parents);
  assertFlowBudget(scene, motion.score);
  if (stateIds(motion).length > 256) throw new Error('The .choco state limit is 256.');
  return document;
}

/** Encoding accepts the compiled contract. SVG and font compilation belong to compileChoco. */
export async function encodeChoco(value: ChocoDocument, attribution?: string): Promise<Uint8Array> {
  const document = validateChocoDocument(value);
  const files = new Map([
    ['scene.json', strToU8(canonicalJson(document.scene))],
    ['motion.json', strToU8(canonicalJson(document.motion))],
  ]);
  if (attribution !== undefined) {
    assertUnicode(attribution);
    const bytes = strToU8(attribution);
    if (bytes.length > 16_384) throw new Error('The attribution exceeds 16 KiB.');
    files.set('ATTRIBUTION.txt', bytes);
  }
  const descriptors = Object.fromEntries(await Promise.all([...files].map(async ([name, bytes]) => [name, { sha256: await chocoDigest(bytes), bytes: bytes.length }])));
  const manifest = {
    format: 'choco', formatVersion: CHOCO_FORMAT_VERSION, formatRevision: CHOCO_FORMAT_REVISION, semanticsVersion: CHOCO_SEMANTICS_VERSION,
    name: document.name, kind: document.kind, palette: document.palette,
    states: stateIds(document.motion), required: requiredCapabilities(document.scene, document.motion), files: descriptors,
  };
  if (!validateManifest(manifest)) throw new Error('Invalid .choco manifest.');
  files.set('manifest.json', strToU8(canonicalJson(manifest)));
  return writeArchive(files);
}

/** No drawable escapes before archive integrity, schemas, graph and capabilities are validated. */
export async function decodeChoco(bytes: Uint8Array, supported = CHOCO_CAPABILITIES) {
  const files = readArchive(bytes);
  const read = (name: string) => {
    const content = files.get(name);
    if (content === undefined) throw new Error(`The .choco file is missing ${name}.`);
    return content;
  };
  const manifest = readJson(read('manifest.json'));
  if (!validateManifest(manifest)) throw new Error('Invalid .choco manifest.');
  assertCapabilities(manifest.required, supported);
  if (files.size !== Object.keys(manifest.files).length + 1) throw new Error('The .choco manifest does not describe every entry.');
  await Promise.all(Object.entries(manifest.files).map(async ([name, descriptor]) => {
    const content = read(name);
    if (descriptor === undefined || content.length !== descriptor.bytes || await chocoDigest(content) !== descriptor.sha256)
      throw new Error(`The .choco integrity check failed for ${name}.`);
  }));
  const document = validateChocoDocument({ name: manifest.name, kind: manifest.kind, palette: manifest.palette, scene: readJson(read('scene.json')), motion: readJson(read('motion.json')) });
  const required = requiredCapabilities(document.scene, document.motion);
  if (canonicalJson(required) !== canonicalJson(manifest.required) || canonicalJson(stateIds(document.motion)) !== canonicalJson(manifest.states))
    throw new Error('The .choco declared capabilities or states do not match its contents.');
  let attribution: string | undefined;
  if (files.has('ATTRIBUTION.txt')) {
    const content = read('ATTRIBUTION.txt');
    if (content.length > 16_384) throw new Error('The attribution exceeds 16 KiB.');
    attribution = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
  }
  return { manifest, document, ...(attribution === undefined ? {} : { attribution }) };
}
