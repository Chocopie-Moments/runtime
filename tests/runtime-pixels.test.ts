import { describe, expect, it } from 'vitest';
import { copyPixels } from '../packages/runtime/src/pixels.ts';

describe('host pixel conversion', () => {
  it('keeps translucent color straight so Canvas does not premultiply it twice', () => {
    const target = new Uint8ClampedArray(16);
    copyPixels(new Uint8Array([128, 0, 0, 128, 31, 16, 8, 64, 1, 1, 1, 1, 20, 30, 40, 0]), target);
    expect([...target]).toEqual([255, 0, 0, 128, 124, 64, 32, 64, 255, 255, 255, 1, 0, 0, 0, 0]);
  });
});
