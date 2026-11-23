/**
 * Checks whether a head scan holds enough data to manufacture a helmet
 * (clinic requirements, Nov 2026):
 *
 * 1. Coverage at least 30 mm below the base of the ears, including the back
 *    and sides of the neck at that level (the front of the neck is not needed).
 * 2. Facial detail present (not capped or smoothed away).
 * 3. No holes in the surface above that level.
 * 4. No "peel": loose flaps or doubled layers of surface.
 *
 * On a first scan, used to make the helmet, a failed check means a rescan.
 * On a follow-up scan the same findings are only flagged.
 */
import { buildFrame, type HeadFrame, type Landmarks, toFrame, tragionFrame } from './frame.js';
import { frameMesh, sliceSegments, slicePieces } from './slice.js';
import type { Mesh } from './stl.js';
import type { Vec2, Vec3 } from './vec.js';

export type CheckId = 'ears' | 'neck' | 'face' | 'holes' | 'peel' | 'fragments';

export interface QualityCheck {
  id: CheckId;
  title: string;
  ok: boolean;
  /** Plain explanation of what was found. */
  detail: string;
  /** Points to highlight on the scan (scan coordinates), if any. */
  markers?: Vec3[];
}

export interface QualityResult {
  /** True when every check passed. */
  ok: boolean;
  /** First scans need every check to pass for manufacture; follow-ups are only flagged. */
  firstScan: boolean;
  /** Short verdict for the clinician. */
  verdict: string;
  checks: QualityCheck[];
  /** Height of the base of each ear and the required lowest level, mm in the measurement frame. */
  levels?: { earBaseLeft: number; earBaseRight: number; required: number; lowestBack: number };
  /** Boundary loops that count as holes, as point lists (scan coordinates) for drawing. */
  holeLoops: Vec3[][];
  /** Triangle indices flagged as peel. */
  peelTriangles: number[];
}

export interface QualityOptions {
  firstScan?: boolean;
  /** Required coverage below the base of the ears, mm. */
  belowEarsMm?: number;
  /** Holes with a perimeter below this are ignored, mm. */
  minHolePerimeterMm?: number;
  /** Peel regions smaller than this are ignored, mm². */
  minPeelAreaMm2?: number;
  /** Facial features must stand out at least this much (RMS) from a smooth surface, mm. */
  minFaceReliefMm?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Shared-vertex topology: welded vertex ids for each triangle corner. */
function weld(mesh: Mesh) {
  const t = mesh.triangles, ids = new Int32Array(mesh.triangleCount * 3), map = new Map<string, number>();
  const verts: Vec3[] = [];
  for (let i = 0; i < ids.length; i++) {
    const x = t[i * 3]!, y = t[i * 3 + 1]!, z = t[i * 3 + 2]!;
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = map.get(k);
    if (id === undefined) { id = verts.length; map.set(k, id); verts.push([x, y, z]); }
    ids[i] = id;
  }
  return { ids, verts };
}

/** Boundary loops: chains of edges used by only one triangle. */
function boundaryLoops(ids: Int32Array, verts: Vec3[]): number[][] {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let f = 0; f < ids.length / 3; f++) {
    for (let e = 0; e < 3; e++) {
      const k = key(ids[f * 3 + e]!, ids[f * 3 + ((e + 1) % 3)]!);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const next = new Map<number, number[]>();
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const [a, b] = k.split('_').map(Number) as [number, number];
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (next.get(b) ?? next.set(b, []).get(b)!).push(a);
  }
  const used = new Set<string>(), loops: number[][] = [];
  for (const [start, nbrs] of next) {
    for (const first of nbrs) {
      if (used.has(key(start, first))) continue;
      const loop = [start];
      let prev = start, cur = first;
      used.add(key(start, first));
      while (cur !== start && loop.length < verts.length) {
        loop.push(cur);
        const options = (next.get(cur) ?? []).filter((v) => !used.has(key(cur, v)));
        const nxt = options.find((v) => v !== prev) ?? options[0];
        if (nxt === undefined) break;
        used.add(key(cur, nxt));
        prev = cur; cur = nxt;
      }
      loops.push(loop);
    }
  }
  return loops;
}

/** Connected pieces of the surface, by shared vertices. Returns the piece id of each triangle. */
function components(ids: Int32Array, nVerts: number): { piece: Int32Array; sizes: number[] } {
  const parent = new Int32Array(nVerts).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  for (let f = 0; f < ids.length / 3; f++) {
    const a = find(ids[f * 3]!), b = find(ids[f * 3 + 1]!), c = find(ids[f * 3 + 2]!);
    parent[b] = a; parent[find(c)] = a;
  }
  const label = new Map<number, number>(), piece = new Int32Array(ids.length / 3), sizes: number[] = [];
  for (let f = 0; f < piece.length; f++) {
    const r = find(ids[f * 3]!);
    let l = label.get(r);
    if (l === undefined) { l = sizes.length; label.set(r, l); sizes.push(0); }
    piece[f] = l; sizes[l]!++;
  }
  return { piece, sizes };
}

/**
 * Base of each ear (lowest point of the ear lobe): working down from the ear
 * top, the level where that side's outline stops sticking out.
 */
function earBases(mesh: Mesh, lm: Landmarks, dropMm = 2.5): { left: Vec3; right: Vec3 } | null {
  if (!lm.earTopLeft || !lm.earTopRight) return null;
  const frame = tragionFrame(lm);
  const fm = frameMesh(mesh, frame);
  const { origin: o, left: l, forward: f, up: u } = frame;
  const at = (p: Vec3, i: 0 | 1 | 2) => o[i] + p[0] * l[i] + p[1] * f[i] + p[2] * u[i];
  const toWorld = (p: Vec3): Vec3 => [at(p, 0), at(p, 1), at(p, 2)];
  const side = (sign: 1 | -1, tragion: Vec3, top: Vec3): Vec3 | null => {
    const ty = toFrame(frame, tragion)[1], hTop = toFrame(frame, top)[2];
    const ext: { h: number; best: number; p: Vec2 | null }[] = [];
    for (let h = hTop - 4; h >= hTop - 70; h -= 0.5) {
      const main = slicePieces(sliceSegments(fm, h))[0];
      let best = -Infinity, p: Vec2 | null = null;
      for (const q of main ?? []) if (Math.abs(q[1] - ty) < 30 && q[0] * sign > best) { best = q[0] * sign; p = q; }
      ext.push({ h, best, p });
    }
    for (let i = 4; i < ext.length; i++) {
      if (ext[i - 4]!.best - ext[i]!.best > dropMm && ext[i - 4]!.p) {
        // Sharpest step within this drop.
        let j = i;
        for (let k = i - 3; k <= i; k++) if (ext[k - 1]!.best - ext[k]!.best > ext[j - 1]!.best - ext[j]!.best) j = k;
        const q = ext[j - 1]!.p!;
        return toWorld([q[0], q[1], ext[j - 1]!.h]);
      }
    }
    return null;
  };
  const left = side(1, lm.tragionLeft, lm.earTopLeft), right = side(-1, lm.tragionRight, lm.earTopRight);
  return left && right ? { left, right } : null;
}

/** Doubled or loose layers of surface: a nearby sheet lying just outside or inside this one. */
function findPeel(mesh: Mesh, keep: (p: Vec3) => boolean): number[] {
  const t = mesh.triangles, n = mesh.triangleCount;
  const cen = new Float64Array(n * 3), nor = new Float64Array(n * 3), area = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const a: Vec3 = [t[f * 9]!, t[f * 9 + 1]!, t[f * 9 + 2]!], b: Vec3 = [t[f * 9 + 3]!, t[f * 9 + 4]!, t[f * 9 + 5]!], c: Vec3 = [t[f * 9 + 6]!, t[f * 9 + 7]!, t[f * 9 + 8]!];
    const nn = cross(sub(b, a), sub(c, a)), l = len(nn) || 1;
    area[f] = l / 2;
    for (let k = 0; k < 3; k++) { cen[f * 3 + k] = (a[k]! + b[k]! + c[k]!) / 3; nor[f * 3 + k] = nn[k]! / l; }
  }
  const cell = 3, grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let f = 0; f < n; f++) {
    const k = key(cen[f * 3]!, cen[f * 3 + 1]!, cen[f * 3 + 2]!);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(f);
  }
  const flagged: number[] = [];
  for (let f = 0; f < n; f++) {
    const c: Vec3 = [cen[f * 3]!, cen[f * 3 + 1]!, cen[f * 3 + 2]!];
    if (!keep(c)) continue;
    const nf: Vec3 = [nor[f * 3]!, nor[f * 3 + 1]!, nor[f * 3 + 2]!];
    const gx = Math.floor(c[0] / cell), gy = Math.floor(c[1] / cell), gz = Math.floor(c[2] / cell);
    let hit = false;
    for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) for (let k = -1; k <= 1 && !hit; k++) {
      for (const g of grid.get(`${gx + i},${gy + j},${gz + k}`) ?? []) {
        if (g === f) continue;
        const d: Vec3 = [cen[g * 3]! - c[0], cen[g * 3 + 1]! - c[1], cen[g * 3 + 2]! - c[2]];
        const along = dot(d, nf);
        if (Math.abs(along) < 0.6 || Math.abs(along) > 3) continue;
        const side = Math.hypot(d[0] - along * nf[0], d[1] - along * nf[1], d[2] - along * nf[2]);
        if (side < 1.0) { hit = true; break; }
      }
    }
    if (hit) flagged.push(f);
  }
  return flagged;
}

/**
 * How much the face stands out from a smooth surface. Builds a front-facing
 * depth map 80 mm wide, from 50 mm below sellion to 16 mm above it, fits a
 * quadratic surface to it, and returns the RMS of what is left.
 */
function faceRelief(mesh: Mesh, lm: Landmarks): { rms: number; coverage: number } {
  const tf = tragionFrame(lm), se = toFrame(tf, lm.sellion);
  const cell = 2, X = 40, Z0 = -50, Z1 = 16, nx = (2 * X) / cell, nz = (Z1 - Z0) / cell;
  const depth = new Float64Array(nx * nz).fill(-Infinity);
  const put = (q: Vec3) => {
    const x = q[0] - se[0], y = q[1] - se[1], z = q[2] - se[2];
    if (y < -40) return;
    const ix = Math.floor((x + X) / cell), iz = Math.floor((z - Z0) / cell);
    if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) return;
    if (y > depth[iz * nx + ix]!) depth[iz * nx + ix] = y;
  };
  // Sample each triangle densely so that every cell it covers gets a value.
  const t = mesh.triangles;
  for (let f = 0; f < mesh.triangleCount; f++) {
    const a = toFrame(tf, [t[f * 9]!, t[f * 9 + 1]!, t[f * 9 + 2]!]);
    const b = toFrame(tf, [t[f * 9 + 3]!, t[f * 9 + 4]!, t[f * 9 + 5]!]);
    const c = toFrame(tf, [t[f * 9 + 6]!, t[f * 9 + 7]!, t[f * 9 + 8]!]);
    const lo = Math.min(a[2], b[2], c[2]) - se[2], hi = Math.max(a[2], b[2], c[2]) - se[2];
    if (hi < Z0 || lo > Z1 || Math.max(a[1], b[1], c[1]) - se[1] < -40) continue;
    const n = Math.max(1, Math.ceil(Math.max(len(sub(a, b)), len(sub(b, c)), len(sub(c, a))) / (cell / 2)));
    for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      put([u * a[0] + v * b[0] + w * c[0], u * a[1] + v * b[1] + w * c[1], u * a[2] + v * b[2] + w * c[2]]);
    }
  }
  const rows: number[][] = [], ys: number[] = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const v = depth[iz * nx + ix]!;
    if (!Number.isFinite(v)) continue;
    const x = (ix + 0.5) * cell - X, z = (iz + 0.5) * cell + Z0;
    rows.push([1, x, z, x * x, x * z, z * z]); ys.push(v);
  }
  const coverage = rows.length / (nx * nz);
  if (rows.length < 12) return { rms: 0, coverage };
  // Least squares by the normal equations (6 x 6, Gauss-Jordan).
  const n = 6, A = Array.from({ length: n }, () => new Array<number>(n).fill(0)), b = new Array<number>(n).fill(0);
  rows.forEach((r, k) => { for (let i = 0; i < n; i++) { b[i]! += r[i]! * ys[k]!; for (let j = 0; j < n; j++) A[i]![j]! += r[i]! * r[j]!; } });
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!]; [b[i], b[p]] = [b[p]!, b[i]!];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r]![i]! / A[i]![i]!;
      for (let c = i; c < n; c++) A[r]![c]! -= f * A[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  const coef = b.map((v, i) => v / A[i]![i]!);
  let ss = 0;
  rows.forEach((r, k) => { const d = ys[k]! - r.reduce((s, v, i) => s + v * coef[i]!, 0); ss += d * d; });
  return { rms: Math.sqrt(ss / rows.length), coverage };
}

const regionName = (frame: HeadFrame, p: Vec3): string => {
  const [x, y, z] = toFrame(frame, p);
  const side = x > 0 ? 'left' : 'right';
  if (y > 25 && Math.abs(x) < 18) return z > 10 ? 'forehead' : z > -25 ? 'eyes and nose' : 'mouth and chin';
  if (y > 25) return z > 10 ? `${side} forehead` : `${side} cheek and jaw`;
  if (y < -25) return z > -40 ? 'back of the head' : 'back of the neck';
  return z > 0 ? `${side} side of the head` : y > -5 ? `${side} cheek and jaw` : `${side} side of the neck`;
};

export function checkScanQuality(mesh: Mesh, landmarks: Landmarks, opts: QualityOptions = {}): QualityResult {
  const firstScan = opts.firstScan ?? true;
  const below = opts.belowEarsMm ?? 30;
  const frame = buildFrame(landmarks); // sellion and ear tops: close to level
  const checks: QualityCheck[] = [];
  const height = (p: Vec3) => toFrame(frame, p)[2];

  // 1. Ears and coverage below them.
  const bases = earBases(mesh, landmarks);
  let required = -Infinity;
  let levels: QualityResult['levels'];
  if (!bases) {
    checks.push({ id: 'ears', title: 'Ears visible', ok: false,
      detail: 'The ears could not be found on the scan, so the base of the ears and the neck coverage cannot be confirmed. The ears may be covered by a cap or smoothed away.' });
    checks.push({ id: 'neck', title: `Neck ${below / 10} cm below the ears`, ok: false,
      detail: 'Cannot be checked without the base of the ears.' });
  } else {
    const hl = height(bases.left), hr = height(bases.right);
    required = Math.min(hl, hr) - below;
    checks.push({ id: 'ears', title: 'Ears visible', ok: true, detail: 'Both ears were found, including the base of each ear.', markers: [bases.left, bases.right] });

    // Back and sides of the neck at the required level.
    const fm = frameMesh(mesh, frame);
    const pts = slicePieces(sliceSegments(fm, required)).flat();
    const cy = Math.min(0, ...pts.map((p) => p[1]).filter((y) => y > -10)) - 10; // a little behind the ears
    const bins = new Array(18).fill(false); // 10-degree bins from left (0) round the back to right (180)
    for (const p of pts) {
      if (p[1] > cy + 15) continue;
      const ang = (Math.atan2(-(p[1] - cy), p[0]) * 180) / Math.PI; // 0 = left, 90 = back, 180 = right
      if (ang >= 0 && ang < 180) bins[Math.floor(ang / 10)] = true;
    }
    const missing = bins.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
    let lowestBack = Infinity;
    const t = mesh.triangles;
    for (let i = 0; i < t.length; i += 3) {
      const q = toFrame(frame, [t[i]!, t[i + 1]!, t[i + 2]!]);
      if (q[1] < -20 && q[2] < lowestBack) lowestBack = q[2];
    }
    levels = { earBaseLeft: hl, earBaseRight: hr, required, lowestBack };
    const where = missing.length
      ? missing.every((i) => i < 6) ? 'the left side of the neck' : missing.every((i) => i >= 12) ? 'the right side of the neck' : 'the back of the neck'
      : '';
    checks.push({ id: 'neck', title: `Neck ${below / 10} cm below the ears`, ok: missing.length === 0 && pts.length > 0,
      detail: pts.length === 0
        ? `The scan stops above the level ${below} mm below the base of the ears. It reaches ${Math.max(0, Math.min(hl, hr) - lowestBack).toFixed(0)} mm below at the back.`
        : missing.length
          ? `At ${below} mm below the base of the ears, part of ${where} is missing (about ${missing.length * 10} degrees of the back half).`
          : `The back and sides of the neck are complete ${below} mm below the base of the ears. The scan reaches ${Math.max(0, Math.min(hl, hr) - lowestBack).toFixed(0)} mm below them at the back.` });
  }

  // 2. Facial detail: the eyes, nose and mouth stand out from a smooth surface.
  //    A capped or smoothed face fits a gently curved surface closely.
  const face = faceRelief(mesh, landmarks);
  const minRelief = opts.minFaceReliefMm ?? 2.8;
  checks.push({ id: 'face', title: 'Facial detail', ok: face.coverage > 0.8 && face.rms >= minRelief,
    detail: face.coverage <= 0.8
      ? `Only ${(face.coverage * 100).toFixed(0)}% of the face was captured. Check that the eyes, nose and mouth are on the scan.`
      : face.rms >= minRelief
        ? `Face present: the eyes, nose and mouth stand out ${face.rms.toFixed(1)} mm from a smooth surface (${minRelief} mm or more expected).`
        : `The face looks smoothed or covered: its features stand out only ${face.rms.toFixed(1)} mm from a smooth surface (${minRelief} mm or more expected). Check that the eyes, nose and mouth were captured.`,
    markers: [landmarks.sellion] });

  const t = mesh.triangles;

  // 3. Holes above the required level.
  const { ids, verts } = weld(mesh);
  const loops = boundaryLoops(ids, verts).map((l) => {
    let per = 0, top = -Infinity;
    for (let i = 0; i < l.length; i++) {
      per += len(sub(verts[l[i]!]!, verts[l[(i + 1) % l.length]!]!));
      top = Math.max(top, height(verts[l[i]!]!));
    }
    return { l, per, top };
  }).sort((a, b) => b.per - a.per);
  const minPer = opts.minHolePerimeterMm ?? 4;
  // The scan's open edge at the neck and shoulders is the largest loop; a loop
  // shorter than a small neck (150 mm around) is a hole, even when it is the largest.
  const holes = (loops[0] && loops[0].per >= 150 ? loops.slice(1) : loops).filter((h) => h.per >= minPer && h.top > required);
  const holeLoops = holes.map((h) => h.l.map((i) => verts[i]!));
  const describe = holes.slice(0, 4).map((h) => {
    const c = h.l.reduce<Vec3>((a, i) => [a[0] + verts[i]![0] / h.l.length, a[1] + verts[i]![1] / h.l.length, a[2] + verts[i]![2] / h.l.length], [0, 0, 0]);
    return `${regionName(frame, c)} (${h.per.toFixed(0)} mm around)`;
  });
  checks.push({ id: 'holes', title: 'No holes', ok: holes.length === 0,
    detail: holes.length === 0
      ? 'No holes in the head, face or neck surface.'
      : `${holes.length} hole${holes.length > 1 ? 's' : ''} in the surface: ${describe.join('; ')}${holes.length > 4 ? '; and more' : ''}.` });

  // 4. Peel: doubled or loose layers, away from the ears (which fold naturally).
  const ears = [landmarks.tragionLeft, landmarks.tragionRight, landmarks.earTopLeft, landmarks.earTopRight].filter(Boolean) as Vec3[];
  const peelRaw = findPeel(mesh, (p) => height(p) > required && ears.every((e) => len(sub(p, e)) > 28));
  // Keep connected peel patches above a minimum area.
  const minArea = opts.minPeelAreaMm2 ?? 60;
  const flaggedSet = new Set(peelRaw);
  const triOf = new Map<number, number[]>();
  for (const f of peelRaw) for (let k = 0; k < 3; k++) (triOf.get(ids[f * 3 + k]!) ?? triOf.set(ids[f * 3 + k]!, []).get(ids[f * 3 + k]!)!).push(f);
  const seen = new Set<number>(), peelTriangles: number[] = [], patches: { area: number; c: Vec3 }[] = [];
  for (const f0 of peelRaw) {
    if (seen.has(f0)) continue;
    const stack = [f0], patch: number[] = [];
    seen.add(f0);
    while (stack.length) {
      const f = stack.pop()!;
      patch.push(f);
      for (let k = 0; k < 3; k++) for (const g of triOf.get(ids[f * 3 + k]!) ?? []) if (!seen.has(g) && flaggedSet.has(g)) { seen.add(g); stack.push(g); }
    }
    let area = 0, c: Vec3 = [0, 0, 0];
    for (const f of patch) {
      const a: Vec3 = [t[f * 9]!, t[f * 9 + 1]!, t[f * 9 + 2]!], b: Vec3 = [t[f * 9 + 3]!, t[f * 9 + 4]!, t[f * 9 + 5]!], cc: Vec3 = [t[f * 9 + 6]!, t[f * 9 + 7]!, t[f * 9 + 8]!];
      area += len(cross(sub(b, a), sub(cc, a))) / 2;
      c = [c[0] + a[0] / patch.length, c[1] + a[1] / patch.length, c[2] + a[2] / patch.length];
    }
    if (area >= minArea) { peelTriangles.push(...patch); patches.push({ area, c }); }
  }
  patches.sort((a, b) => b.area - a.area);
  checks.push({ id: 'peel', title: 'No peel', ok: patches.length === 0,
    detail: patches.length === 0
      ? 'No loose flaps or doubled layers of surface.'
      : `Doubled or loose surface ("peel") in ${patches.length} place${patches.length > 1 ? 's' : ''}${patches.length > 4 ? ', the largest' : ''}: ${patches.slice(0, 4).map((p) => `${regionName(frame, p.c)} (${(p.area / 100).toFixed(1)} cm²)`).join('; ')}.`,
    markers: patches.map((p) => p.c) });

  // 5. Loose fragments: separate pieces apart from the head.
  const { piece, sizes } = components(ids, verts.length);
  const main = sizes.indexOf(Math.max(...sizes));
  let fragTris = 0;
  for (let f = 0; f < piece.length; f++) if (piece[f] !== main) fragTris++;
  const fragments = sizes.filter((s, i) => i !== main && s >= 20).length;
  checks.push({ id: 'fragments', title: 'No loose pieces', ok: fragments === 0,
    detail: fragments === 0 ? 'The scan is one connected surface.' : `${fragments} separate piece${fragments > 1 ? 's' : ''} of surface float apart from the head (${fragTris} triangles). They are usually scanning artefacts.` });

  const ok = checks.every((c) => c.ok);
  const problem: Record<CheckId, string> = { ears: 'ears not found', neck: 'neck not covered', face: 'face missing or smoothed', holes: 'holes', peel: 'peel', fragments: 'loose pieces' };
  const failed = checks.filter((c) => !c.ok).map((c) => (c.id === 'neck' && !bases ? 'neck coverage not checked' : problem[c.id]));
  const verdict = ok
    ? 'Enough data to manufacture a helmet.'
    : firstScan
      ? `Not enough data to manufacture a helmet: please rescan (${failed.join(', ')}).`
      : `Scan flagged for review (${failed.join(', ')}). A new scan is not required for a follow-up.`;
  return { ok, firstScan, verdict, checks, ...(levels ? { levels } : {}), holeLoops, peelTriangles };
}
