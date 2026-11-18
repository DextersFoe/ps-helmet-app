/**
 * Cuts the mesh with a plane parallel to the reference plane and returns the
 * outline of the head at that level, in head-frame 2D coordinates
 * ([left, forward], mm).
 */
import type { HeadFrame } from './frame.js';
import type { Mesh } from './stl.js';
import type { Vec2 } from './vec.js';

/** Mesh vertices transformed into the head frame, computed once per scan. */
export interface FramedMesh {
  /** left, forward, up for each triangle vertex (9 numbers per triangle). */
  readonly coords: Float64Array;
  readonly triangleCount: number;
  /** Highest point above the reference plane (the vertex of the head). */
  readonly maxUp: number;
  /** Lowest point below the reference plane (chin, neck or shoulders), as a positive distance. */
  readonly maxDown: number;
}

export function frameMesh(mesh: Mesh, frame: HeadFrame): FramedMesh {
  const t = mesh.triangles;
  const out = new Float64Array(t.length);
  const { origin: o, left: l, forward: f, up: u } = frame;
  let maxUp = -Infinity;
  let minUp = Infinity;
  for (let i = 0; i < t.length; i += 3) {
    const dx = t[i]! - o[0];
    const dy = t[i + 1]! - o[1];
    const dz = t[i + 2]! - o[2];
    out[i] = dx * l[0] + dy * l[1] + dz * l[2];
    out[i + 1] = dx * f[0] + dy * f[1] + dz * f[2];
    const up = dx * u[0] + dy * u[1] + dz * u[2];
    out[i + 2] = up;
    if (up > maxUp) maxUp = up;
    if (up < minUp) minUp = up;
  }
  return { coords: out, triangleCount: mesh.triangleCount, maxUp, maxDown: -minUp };
}

export type Segment = readonly [Vec2, Vec2];

/** All line segments where the mesh crosses the plane at the given height. */
export function sliceSegments(fm: FramedMesh, height: number): Segment[] {
  const c = fm.coords;
  const segments: Segment[] = [];
  const pts: Vec2[] = [];
  for (let t = 0; t < fm.triangleCount; t++) {
    const b = t * 9;
    pts.length = 0;
    for (let e = 0; e < 3; e++) {
      const i = b + e * 3;
      const j = b + ((e + 1) % 3) * 3;
      const zi = c[i + 2]! - height;
      const zj = c[j + 2]! - height;
      if (zi < 0 === zj < 0) continue;
      // Interpolate from the lower vertex so shared edges give identical points.
      const [lo, hi, zlo, zhi] = zi < zj ? [i, j, zi, zj] : [j, i, zj, zi];
      const s = zlo / (zlo - zhi);
      pts.push([c[lo]! + s * (c[hi]! - c[lo]!), c[lo + 1]! + s * (c[hi + 1]! - c[lo + 1]!)]);
    }
    if (pts.length === 2) segments.push([pts[0]!, pts[1]!]);
  }
  return segments;
}

/**
 * Groups segments into connected pieces, joining ends that are within
 * `gap` mm so small holes in the scan do not break the outline.
 * Returns the points of each piece, largest piece (by outline length) first.
 */
export function slicePieces(segments: Segment[], gap = 3): Vec2[][] {
  const n = segments.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / gap)},${Math.floor(y / gap)}`;
  segments.forEach((seg, i) => {
    for (const p of seg) {
      const cx = Math.floor(p[0] / gap);
      const cy = Math.floor(p[1] / gap);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
            const q = segments[j]!;
            if (q.some((r) => Math.hypot(r[0] - p[0], r[1] - p[1]) <= gap)) {
              parent[find(i)] = find(j);
            }
          }
        }
      }
      const k = key(p[0], p[1]);
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    }
  });
  const groups = new Map<number, { pts: Vec2[]; len: number }>();
  segments.forEach((seg, i) => {
    const r = find(i);
    const g = groups.get(r) ?? { pts: [], len: 0 };
    g.pts.push(seg[0], seg[1]);
    g.len += Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
    groups.set(r, g);
  });
  return [...groups.values()].sort((a, b) => b.len - a.len).map((g) => g.pts);
}
