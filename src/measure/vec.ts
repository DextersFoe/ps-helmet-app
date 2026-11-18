/** Minimal 3D and 2D vector helpers. All lengths are in millimetres. */

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-12) throw new Error('Cannot normalise a zero-length vector');
  return scale(a, 1 / len);
}

export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
