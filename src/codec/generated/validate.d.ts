import type { ChocoDocument, ChocoManifest } from '../schema.ts';
export function validateManifest(value: unknown): value is ChocoManifest;
export function validateDocument(value: unknown): value is ChocoDocument;
