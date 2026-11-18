/** Synthetic test shapes with known dimensions. */
import type { Mesh } from '../src/measure/stl.js';

type P = [number, number, number];

function toMesh(tris: P[][]): Mesh {
  const out = new Float64Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((p, k) => out.set(p, i * 9 + k * 3)));
  return { triangles: out, triangleCount: tris.length };
}

/**
 * Ellipsoid centred at (0, 0, cz) with horizontal semi-axes a and b, turned
 * by `rotDeg` about the vertical axis, and vertical semi-axis c.
 */
export function ellipsoid(a: number, b: number, c: number, cz: number, rotDeg = 0, seg = 360): Mesh {
  const rot = (rotDeg * Math.PI) / 180;
  const pt = (u: number, v: number): P => {
    const x0 = a * Math.cos(v) * Math.cos(u);
    const y0 = b * Math.cos(v) * Math.sin(u);
    return [x0 * Math.cos(rot) - y0 * Math.sin(rot), x0 * Math.sin(rot) + y0 * Math.cos(rot), cz + c * Math.sin(v)];
  };
  const tris: P[][] = [];
  const rings = seg / 2;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rings; j++) {
      const u0 = (2 * Math.PI * i) / seg;
      const u1 = (2 * Math.PI * (i + 1)) / seg;
      const v0 = -Math.PI / 2 + (Math.PI * j) / rings;
      const v1 = -Math.PI / 2 + (Math.PI * (j + 1)) / rings;
      tris.push([pt(u0, v0), pt(u1, v0), pt(u1, v1)], [pt(u0, v0), pt(u1, v1), pt(u0, v1)]);
    }
  }
  return toMesh(tris);
}

/** A closed box, used as a stand-in for an ear. */
export function box(min: P, max: P): Mesh {
  const c = (i: number): P => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const faces = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  const tris: P[][] = [];
  for (const [p, q, r, s] of faces) tris.push([c(p!), c(q!), c(r!)], [c(p!), c(r!), c(s!)]);
  return toMesh(tris);
}

export function merge(...meshes: Mesh[]): Mesh {
  const total = meshes.reduce((n, m) => n + m.triangleCount, 0);
  const out = new Float64Array(total * 9);
  let at = 0;
  for (const m of meshes) {
    out.set(m.triangles, at);
    at += m.triangles.length;
  }
  return { triangles: out, triangleCount: total };
}

/** Diameter of a centred ellipse (semi-axes a, b, turned by rot) along direction angle theta. */
export function ellipseDiameter(a: number, b: number, rot: number, theta: number): number {
  const t = theta - rot;
  return 2 / Math.sqrt((Math.cos(t) / a) ** 2 + (Math.sin(t) / b) ** 2);
}

/** Ramanujan's approximation to an ellipse perimeter. */
export function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Binary STL bytes for a mesh. */
export function toBinaryStl(mesh: Mesh): Uint8Array {
  const buf = new ArrayBuffer(84 + mesh.triangleCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, mesh.triangleCount, true);
  for (let t = 0; t < mesh.triangleCount; t++) {
    for (let k = 0; k < 9; k++) view.setFloat32(84 + t * 50 + 12 + k * 4, mesh.triangles[t * 9 + k]!, true);
  }
  return new Uint8Array(buf);
}
