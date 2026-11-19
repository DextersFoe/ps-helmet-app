/**
 * Measures a follow-up scan at the same anatomical level as the baseline scan.
 *
 * 1. Line the follow-up up with the baseline (turn, shift and uniform scale,
 *    matched on the cranial vault).
 * 2. Carry the baseline landmarks across, then snap each to the follow-up surface.
 * 3. Keep the measurement level at the same fraction of the vertex height above
 *    the reference plane as on the baseline, so it stays at the same place on
 *    the head as the head grows. The level in mm is reported too.
 */
import { applySimilarity, invertSimilarity, registerScans, type Similarity } from '../align/register.js';
import { buildFrame, type Landmarks } from './frame.js';
import { measureHead, type Measurements } from './measure.js';
import { frameMesh } from './slice.js';
import type { Mesh } from './stl.js';
import type { Vec3 } from './vec.js';

export interface Baseline {
  mesh: Mesh;
  landmarks: Landmarks;
  measurements: Measurements;
}

export interface FollowUpResult {
  /** Maps follow-up coordinates into baseline coordinates. */
  transform: Similarity;
  medianResidualMm: number;
  /** Landmarks on the follow-up scan, in its own coordinates. */
  landmarks: Landmarks;
  /** Measurement level as a fraction of the vertex height above the reference plane. */
  levelFraction: number;
  measurements: Measurements;
}

/** Fraction of the head's height above the reference plane at which a scan was measured. */
export function levelFraction(mesh: Mesh, landmarks: Landmarks, planeHeight: number): number {
  return planeHeight / frameMesh(mesh, buildFrame(landmarks)).maxUp;
}

/** One point per triangle (its centre) and the triangle's unit normal, for triangles passing `keep`. */
export function surfaceSamples(mesh: Mesh, keep: (p: Vec3) => boolean): { points: Float64Array; normals: Float64Array } {
  const pts: number[] = [], nrm: number[] = [];
  const t = mesh.triangles;
  for (let i = 0; i < t.length; i += 9) {
    const p: Vec3 = [(t[i]! + t[i + 3]! + t[i + 6]!) / 3, (t[i + 1]! + t[i + 4]! + t[i + 7]!) / 3, (t[i + 2]! + t[i + 5]! + t[i + 8]!) / 3];
    if (!keep(p)) continue;
    const e1 = [t[i + 3]! - t[i]!, t[i + 4]! - t[i + 1]!, t[i + 5]! - t[i + 2]!];
    const e2 = [t[i + 6]! - t[i]!, t[i + 7]! - t[i + 1]!, t[i + 8]! - t[i + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len < 1e-12) continue;
    pts.push(...p);
    nrm.push(n[0]! / len, n[1]! / len, n[2]! / len);
  }
  return { points: Float64Array.from(pts), normals: Float64Array.from(nrm) };
}

function snap(mesh: Mesh, p: Vec3): Vec3 {
  const t = mesh.triangles;
  let best: Vec3 = p, bestD = Infinity;
  for (let i = 0; i < t.length; i += 3) {
    const d = (t[i]! - p[0]) ** 2 + (t[i + 1]! - p[1]) ** 2 + (t[i + 2]! - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = [t[i]!, t[i + 1]!, t[i + 2]!]; }
  }
  return best;
}

export function measureFollowUp(baseline: Baseline, followUp: Mesh, opts: { landmarks?: Landmarks } = {}): FollowUpResult {
  const frame0 = buildFrame(baseline.landmarks);
  const up0 = frame0.up, o0 = frame0.origin;
  // Baseline cranial vault: more than 10 mm above the reference plane.
  const above = (p: Vec3) => (p[0] - o0[0]) * up0[0] + (p[1] - o0[1]) * up0[1] + (p[2] - o0[2]) * up0[2] > 10;
  const fixed = surfaceSamples(baseline.mesh, above);
  // Follow-up: the upper 55% of the scan's height (the scanner's vertical is shared).
  let zMin = Infinity, zMax = -Infinity;
  const t = followUp.triangles;
  for (let i = 2; i < t.length; i += 3) { zMin = Math.min(zMin, t[i]!); zMax = Math.max(zMax, t[i]!); }
  const moving = surfaceSamples(followUp, (p) => p[2] > zMin + 0.45 * (zMax - zMin)).points;
  const reg = registerScans(moving, fixed.points, { overlap: above, fixedNormals: fixed.normals });

  const landmarks: Landmarks = opts.landmarks ?? {
    sellion: snap(followUp, invertSimilarity(reg.transform, baseline.landmarks.sellion)),
    tragionLeft: snap(followUp, invertSimilarity(reg.transform, baseline.landmarks.tragionLeft)),
    tragionRight: snap(followUp, invertSimilarity(reg.transform, baseline.landmarks.tragionRight)),
  };
  const fraction = levelFraction(baseline.mesh, baseline.landmarks, baseline.measurements.planeHeight);
  const maxUp = frameMesh(followUp, buildFrame(landmarks)).maxUp;
  const measurements = measureHead(followUp, landmarks, { planeHeight: fraction * maxUp });
  return { transform: reg.transform, medianResidualMm: reg.medianResidualMm, landmarks, levelFraction: fraction, measurements };
}

export { applySimilarity };
