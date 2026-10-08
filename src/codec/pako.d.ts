/** The documented binary streaming surface used from the pinned pako 2.2 release. */
declare module 'pako/lib/inflate.js' {
  export class Inflate {
    constructor(options: { raw: true; chunkSize: number });
    onData(chunk: Uint8Array): void;
    /** False on malformed input or after the end of the compressed stream. */
    push(chunk: Uint8Array, final: boolean): boolean;
  }
}
