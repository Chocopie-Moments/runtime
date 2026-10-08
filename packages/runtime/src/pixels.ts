/** ThorVG gives premultiplied sRGB RGBA, while Canvas/ImageData and media encoders need straight RGBA. */
export function copyPixels(source: Uint8Array, target: Uint8ClampedArray) {
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3];
    const scale = alpha ? 255 / alpha : 0;
    target[i] = Math.round(source[i] * scale);
    target[i + 1] = Math.round(source[i + 1] * scale);
    target[i + 2] = Math.round(source[i + 2] * scale);
    target[i + 3] = alpha;
  }
}
