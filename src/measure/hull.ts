/**
 * 2D convex hull and ray intersection.
 *
 * Measurements are taken on the convex hull of the head outline. This matches
 * how calipers and a tape measure behave: they bridge small hollows (for example
 * gaps in the scan or folds in the cap) rather than following them.
 */
import type { Vec2 } from './vec.js';

/** Andrew's monotone chain. Returns hull vertices counter-clockwise. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const turn = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && turn(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function perimeter(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

/**
 * Distance from `origin` along `dir` (unit vector) to where the ray leaves a
 * convex polygon that contains the origin.
 */
export function rayExit(poly: readonly Vec2[], origin: Vec2, dir: Vec2): number {
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const t = (ax * ey - ay * ex) / den;
    const s = (ax * dir[1] - ay * dir[0]) / den;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t > best) best = t;
  }
  if (best < 0) throw new Error('Measurement centre lies outside the head outline');
  return best;
}
