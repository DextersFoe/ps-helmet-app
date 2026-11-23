/**
 * Lines up a follow-up head scan with the baseline scan of the same infant.
 *
 * The head grows between visits, so the fit allows a uniform scale as well as a
 * turn and a shift (a similarity transform). Only the cranial vault is matched,
 * because the face, neck and shoulders move with posture. The closest 60% of
 * point pairs drive each step, so areas that genuinely changed shape (the
 * corrected flat spot) do not pull the fit.
 */
import type { Vec3 } from '../measure/vec.js';

export interface Similarity {
  /** Row-major 3x3 rotation. */
  rotation: number[];
  scale: number;
  translation: Vec3;
}

export interface RegistrationResult {
  /** Maps follow-up coordinates into baseline coordinates. */
  transform: Similarity;
  /** Median distance between matched points after the fit, mm. */
  medianResidualMm: number;
}

export const applySimilarity = (t: Similarity, p: Vec3): Vec3 => {
  const r = t.rotation;
  return [
    t.scale * (r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2]) + t.translation[0],
    t.scale * (r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2]) + t.translation[1],
    t.scale * (r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2]) + t.translation[2],
  ];
};

/** Baseline point to follow-up coordinates (the inverse transform). */
export const invertSimilarity = (t: Similarity, p: Vec3): Vec3 => {
  const r = t.rotation;
  const d = [p[0] - t.translation[0], p[1] - t.translation[1], p[2] - t.translation[2]];
  return [
    (r[0]! * d[0]! + r[3]! * d[1]! + r[6]! * d[2]!) / t.scale,
    (r[1]! * d[0]! + r[4]! * d[1]! + r[7]! * d[2]!) / t.scale,
    (r[2]! * d[0]! + r[5]! * d[1]! + r[8]! * d[2]!) / t.scale,
  ];
};

/** Uniform grid for nearest-point queries. */
class PointGrid {
  private cells = new Map<string, number[]>();
  constructor(private pts: Float64Array, private cell = 4) {
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!);
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** Nearest point index and distance, searching outwards up to `maxRings` cells. */
  nearest(x: number, y: number, z: number, maxRings = 6): [number, number] {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxRings; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
        for (const idx of this.cells.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
          const dx = this.pts[idx * 3]! - x, dy = this.pts[idx * 3 + 1]! - y, dz = this.pts[idx * 3 + 2]! - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      // Anything in a further ring is at least r cells away.
      if (best >= 0 && Math.sqrt(bestD) <= r * this.cell) break;
    }
    return [best, Math.sqrt(bestD)];
  }
}

/** Closed-form best similarity transform (Umeyama) from point pairs. */
function umeyama(a: number[][], b: number[][]): Similarity {
  const n = a.length;
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k]! += a[i]![k]! / n; cb[k]! += b[i]![k]! / n; }
  const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let varA = 0;
  for (let i = 0; i < n; i++) {
    const p = [a[i]![0]! - ca[0]!, a[i]![1]! - ca[1]!, a[i]![2]! - ca[2]!];
    const q = [b[i]![0]! - cb[0]!, b[i]![1]! - cb[1]!, b[i]![2]! - cb[2]!];
    varA += (p[0]! ** 2 + p[1]! ** 2 + p[2]! ** 2) / n;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r * 3 + c]! += (q[r]! * p[c]!) / n;
  }
  const { U, S, V } = svd3(H);
  const det = det3(mul3(U, transpose3(V)));
  const D = [1, 1, det < 0 ? -1 : 1];
  const R = mul3(mul3(U, diag3(D)), transpose3(V));
  const scale = (S[0]! * D[0]! + S[1]! * D[1]! + S[2]! * D[2]!) / varA;
  const rca = [
    R[0]! * ca[0]! + R[1]! * ca[1]! + R[2]! * ca[2]!,
    R[3]! * ca[0]! + R[4]! * ca[1]! + R[5]! * ca[2]!,
    R[6]! * ca[0]! + R[7]! * ca[1]! + R[8]! * ca[2]!,
  ];
  return { rotation: R, scale, translation: [cb[0]! - scale * rca[0]!, cb[1]! - scale * rca[1]!, cb[2]! - scale * rca[2]!] };
}

/**
 * Registers `moving` (follow-up points) onto `fixed` (baseline cranial vault points).
 * Both are flat xyz arrays in mm.
 *
 * A head is nearly round about its vertical axis, so a fit started from the
 * wrong turn can settle in the wrong place. A coarse pass therefore tries 24
 * starting turns about the vertical on a small sample, and the best one is
 * refined on a larger sample. During refinement only follow-up points that
 * land on the baseline vault are used, so both sides cover the same region.
 */
export function registerScans(
  moving: Float64Array,
  fixed: Float64Array,
  opts: {
    coarseTurns?: number; refineIterations?: number; sample?: number; overlap?: (p: Vec3) => boolean;
    initial?: Similarity; keep?: number;
    /** Unit surface normals for `fixed` (xyz per point). Enables point-to-plane fitting, which converges far faster on a smooth head. */
    fixedNormals?: Float64Array;
  } = {},
): RegistrationResult {
  const grid = new PointGrid(fixed);
  const sample = (pts: Float64Array, count: number) => {
    const n = pts.length / 3, step = Math.max(1, Math.floor(n / count)), out: number[][] = [];
    for (let i = 0; i < n; i += step) out.push([pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!]);
    return out;
  };
  const centroid = (pts: number[][]) =>
    pts.reduce((c, p) => [c[0]! + p[0]! / pts.length, c[1]! + p[1]! / pts.length, c[2]! + p[2]! / pts.length], [0, 0, 0]);
  const spread = (pts: number[][], c: number[]) =>
    Math.sqrt(pts.reduce((s, p) => s + (p[0]! - c[0]!) ** 2 + (p[1]! - c[1]!) ** 2 + (p[2]! - c[2]!) ** 2, 0) / pts.length);
  const fixedPts = sample(fixed, 4000);
  const cf = centroid(fixedPts);

  const run = (src: number[][], t0: Similarity, iterations: number, keepFraction: number) => {
    let t = t0, residual = Infinity;
    for (let it = 0; it < iterations; it++) {
      const pairs: Pair[] = [];
      for (const p of src) {
        const q = applySimilarity(t, p as unknown as Vec3);
        if (opts.overlap && it > 0 && !opts.overlap(q)) continue;
        const [j, d] = grid.nearest(q[0], q[1], q[2]);
        if (j >= 0) pairs.push({ a: p, b: [fixed[j * 3]!, fixed[j * 3 + 1]!, fixed[j * 3 + 2]!], d, j });
      }
      if (pairs.length < 10) break;
      pairs.sort((x, y) => x.d - y.d);
      residual = pairs[Math.floor(pairs.length / 2)]!.d;
      const keep = pairs.slice(0, Math.floor(pairs.length * keepFraction));
      t = opts.fixedNormals ? pointToPlaneStep(t, keep, opts.fixedNormals) : umeyama(keep.map((k) => k.a), keep.map((k) => k.b));
    }
    return { transform: t, medianResidualMm: residual };
  };

  const small = sample(moving, 800);
  const cm = centroid(small);
  const s0 = spread(fixedPts, cf) / spread(small, cm);
  const candidates: RegistrationResult[] = opts.initial ? [{ transform: opts.initial, medianResidualMm: 0 }] : [];
  const turns = opts.initial ? 0 : opts.coarseTurns ?? 24;
  for (let k = 0; k < turns; k++) {
    const a = (2 * Math.PI * k) / turns, c = Math.cos(a), s = Math.sin(a);
    const R0 = [c, -s, 0, s, c, 0, 0, 0, 1];
    const rc = [R0[0]! * cm[0]! + R0[1]! * cm[1]!, R0[3]! * cm[0]! + R0[4]! * cm[1]!, cm[2]!];
    const t0: Similarity = { rotation: R0, scale: s0, translation: [cf[0]! - s0 * rc[0]!, cf[1]! - s0 * rc[1]!, cf[2]! - s0 * rc[2]!] };
    candidates.push(run(small, t0, 15, opts.keep ?? 0.9));
  }
  // Refine the three most promising starts fully and keep the best fit.
  candidates.sort((x, y) => x.medianResidualMm - y.medianResidualMm);
  const big = sample(moving, opts.sample ?? 3000);
  let best: RegistrationResult | null = null;
  for (const c of candidates.slice(0, 3)) {
    const r = run(big, c.transform, opts.refineIterations ?? 60, opts.keep ?? 0.9);
    if (!best || r.medianResidualMm < best.medianResidualMm) best = r;
  }
  return best!;
}

interface Pair { a: number[]; b: number[]; d: number; j: number }

/**
 * One linearised point-to-plane step with uniform scale: solves for a small
 * turn w, shift d and scale change k minimising the sum over pairs of
 * ((1+k)(q-c) + w x (q-c) + c + d - b) . n, then composes it onto t.
 */
function pointToPlaneStep(t: Similarity, pairs: Pair[], normals: Float64Array): Similarity {
  const qs = pairs.map((p) => applySimilarity(t, p.a as unknown as Vec3));
  const c = [0, 0, 0];
  for (const q of qs) for (let k = 0; k < 3; k++) c[k]! += q[k]! / qs.length;
  const AtA = Array.from({ length: 7 }, () => new Array<number>(7).fill(0));
  const Atb = new Array<number>(7).fill(0);
  pairs.forEach((p, i) => {
    const q = qs[i]!, j = p.j;
    const n = [normals[j * 3]!, normals[j * 3 + 1]!, normals[j * 3 + 2]!];
    const r = [q[0]! - c[0]!, q[1]! - c[1]!, q[2]! - c[2]!];
    const cx = [r[1]! * n[2]! - r[2]! * n[1]!, r[2]! * n[0]! - r[0]! * n[2]!, r[0]! * n[1]! - r[1]! * n[0]!];
    const row = [cx[0]!, cx[1]!, cx[2]!, n[0]!, n[1]!, n[2]!, r[0]! * n[0]! + r[1]! * n[1]! + r[2]! * n[2]!];
    const e = (p.b[0]! - q[0]!) * n[0]! + (p.b[1]! - q[1]!) * n[1]! + (p.b[2]! - q[2]!) * n[2]!;
    for (let a = 0; a < 7; a++) { Atb[a]! += row[a]! * e; for (let b = 0; b < 7; b++) AtA[a]![b]! += row[a]! * row[b]!; }
  });
  for (let a = 0; a < 7; a++) AtA[a]![a]! += 1e-6;
  const x = solve(AtA, Atb);
  const w = [x[0]!, x[1]!, x[2]!], d = [x[3]!, x[4]!, x[5]!], k = x[6]!;
  const Rw = rodrigues(w);
  const rotation = mul3(Rw, t.rotation);
  const tc = [t.translation[0] - c[0]!, t.translation[1] - c[1]!, t.translation[2] - c[2]!];
  const rtc = [0, 1, 2].map((r) => Rw[r * 3]! * tc[0]! + Rw[r * 3 + 1]! * tc[1]! + Rw[r * 3 + 2]! * tc[2]!);
  return {
    rotation,
    scale: t.scale * (1 + k),
    translation: [0, 1, 2].map((r) => (1 + k) * rtc[r]! + c[r]! + d[r]!) as unknown as Vec3,
  };
}

function rodrigues(w: number[]): number[] {
  const th = Math.hypot(w[0]!, w[1]!, w[2]!);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = [w[0]! / th, w[1]! / th, w[2]! / th];
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let k = col; k <= n; k++) M[r]![k]! -= f * M[col]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let k = r + 1; k < n; k++) sum -= M[r]![k]! * x[k]!;
    x[r] = sum / M[r]![r]!;
  }
  return x;
}

// ---- small 3x3 helpers (row-major) ----
const transpose3 = (m: number[]) => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
const diag3 = (d: number[]) => [d[0]!, 0, 0, 0, d[1]!, 0, 0, 0, d[2]!];
const det3 = (m: number[]) =>
  m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
function mul3(a: number[], b: number[]) {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c]! += a[r * 3 + k]! * b[k * 3 + c]!;
  return o;
}

/** SVD of a 3x3 matrix via Jacobi eigen-decomposition of HᵀH. */
function svd3(H: number[]): { U: number[]; S: number[]; V: number[] } {
  const A = mul3(transpose3(H), H);
  let V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const a = [...A];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q]!;
      off += Math.abs(apq);
      if (Math.abs(apq) < 1e-15) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(tt * tt + 1), s = tt * c;
      const J = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      J[p * 3 + p] = c; J[q * 3 + q] = c; J[p * 3 + q] = s; J[q * 3 + p] = -s;
      const na = mul3(mul3(transpose3(J), a), J);
      for (let i = 0; i < 9; i++) a[i] = na[i]!;
      V = mul3(V, J);
    }
    if (off < 1e-12) break;
  }
  const eig = [a[0]!, a[4]!, a[8]!];
  const order = [0, 1, 2].sort((i, j) => eig[j]! - eig[i]!);
  const Vs = new Array<number>(9);
  order.forEach((col, k) => { for (let r = 0; r < 3; r++) Vs[r * 3 + k] = V[r * 3 + col]!; });
  const S = order.map((i) => Math.sqrt(Math.max(eig[i]!, 0)));
  // U = H V S⁻¹, completed to an orthonormal basis if a singular value is ~0.
  const HV = mul3(H, Vs);
  const U = new Array<number>(9).fill(0);
  for (let k = 0; k < 3; k++) for (let r = 0; r < 3; r++) U[r * 3 + k] = S[k]! > 1e-12 ? HV[r * 3 + k]! / S[k]! : 0;
  if (S[2]! <= 1e-12) {
    const u0 = [U[0]!, U[3]!, U[6]!], u1 = [U[1]!, U[4]!, U[7]!];
    const u2 = [u0[1]! * u1[2]! - u0[2]! * u1[1]!, u0[2]! * u1[0]! - u0[0]! * u1[2]!, u0[0]! * u1[1]! - u0[1]! * u1[0]!];
    U[2] = u2[0]!; U[5] = u2[1]!; U[8] = u2[2]!;
  }
  return { U, S, V: Vs };
}
