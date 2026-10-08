import type { Matrix, Point } from './math.ts';
export type PaletteRole = 'accent' | 'secondary' | 'ink' | 'background';
export type Segment = { readonly c1: Point; readonly c2: Point; readonly to: Point; readonly line: boolean };
export type Contour = { readonly start: Point; readonly segments: readonly Segment[]; readonly closed: boolean };
export type ScenePaint =
  | { readonly kind: 'none' }
  | { readonly kind: 'color'; readonly rgba: readonly [number, number, number, number]; readonly role?: PaletteRole }
  | { readonly kind: 'linear' | 'radial'; readonly transform: Matrix; readonly spread: 'pad' | 'repeat' | 'reflect'; readonly values: readonly number[]; readonly stops: readonly { readonly offset: number; readonly rgba: readonly [number, number, number, number]; readonly role?: PaletteRole }[] };
export type SceneShape = {
  readonly contours: readonly Contour[];
  readonly fill: ScenePaint;
  readonly stroke: ScenePaint;
  readonly fillRule: 'nonzero' | 'evenodd';
  readonly strokeWidth: number;
  readonly linecap: 'butt' | 'round' | 'square';
  readonly linejoin: 'miter' | 'round' | 'bevel';
  readonly miterlimit: number;
  readonly dasharray: readonly number[];
  readonly dashoffset: number;
};
export type SceneNode = {
  /** Bindings connect scene nodes to motion handles. */
  readonly bindings?: readonly string[];
  readonly transform: Matrix;
  readonly opacity: number;
  readonly displayed: boolean;
  readonly visible: boolean;
  readonly part?: { readonly id: string; readonly name: string; readonly background: boolean };
  readonly shape?: SceneShape;
  readonly clip?: SceneNode;
  readonly children: readonly SceneNode[];
};
export type Scene = { readonly viewBox: readonly [number, number, number, number]; readonly root: SceneNode };

