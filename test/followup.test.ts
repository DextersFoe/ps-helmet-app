import { describe, expect, it } from 'vitest';
import { applySimilarity, invertSimilarity, registerScans } from '../src/align/register.js';
import { measureFollowUp, surfaceSamples } from '../src/measure/followup.js';
import { measureHead } from '../src/measure/measure.js';
import type { Mesh } from '../src/measure/stl.js';
import type { Landmarks } from '../src/measure/frame.js';
import type { Vec3 } from '../src/measure/vec.js';
import { ellipsoid } from './shapes.js';

const A = 64, B = 76, C = 90, CZ = 20;
const k = Math.sqrt(1 - (CZ / C) ** 2);
const landmarks: Landmarks = { sellion: [0, B * k, 0], tragionLeft: [-A * k, 0, 0], tragionRight: [A * k, 0, 0] };

/** Moves a mesh as a scanner might: turned about the vertical, grown, and shifted. */
function moved(mesh: Mesh, deg: number, scale: number, shift: Vec3): Mesh {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const t = new Float64Array(mesh.triangles.length);
  for (let i = 0; i < t.length; i += 3) {
    const x = mesh.triangles[i]!, y = mesh.triangles[i + 1]!, z = mesh.triangles[i + 2]!;
    t[i] = scale * (c * x - s * y) + shift[0];
    t[i + 1] = scale * (s * x + c * y) + shift[1];
    t[i + 2] = scale * z + shift[2];
  }
  return { triangles: t, triangleCount: mesh.triangleCount };
}

describe('similarity registration', () => {
  it('inverts its own transform', () => {
    const tr = { rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1], scale: 1.1, translation: [3, -4, 5] as Vec3 };
    const p: Vec3 = [10, 20, 30];
    const back = invertSimilarity(tr, applySimilarity(tr, p));
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i]!, 9));
  });

  it('recovers a turned, grown and shifted head', () => {
    const base = ellipsoid(A, B, C, CZ, 0, 120);
    const follow = moved(base, 93, 1.05, [12, -7, 4]);
    const all = () => true;
    const fixed = surfaceSamples(base, all);
    const { transform, medianResidualMm } = registerScans(surfaceSamples(follow, all).points, fixed.points, {
      fixedNormals: fixed.normals,
    });
    expect(transform.scale).toBeCloseTo(1 / 1.05, 2);
    expect(medianResidualMm).toBeLessThan(1);
  });
});

describe('follow-up measurement', () => {
  const baseMesh = ellipsoid(A, B, C, CZ, 0, 240);
  const baseline = { mesh: baseMesh, landmarks, measurements: measureHead(baseMesh, landmarks) };
  const grow = 1.06;
  const follow = measureFollowUp(baseline, moved(baseMesh, 90, grow, [5, 5, 0]));

  it('carries the landmarks across to the follow-up scan', () => {
    // The follow-up sellion is the baseline one, grown and turned 90 degrees.
    const expected: Vec3 = [5 - grow * landmarks.sellion[1], 5 + grow * landmarks.sellion[0], 0];
    follow.landmarks.sellion.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThan(2.5));
  });

  it('measures at the same place on the head, scaled with growth', () => {
    expect(follow.measurements.planeHeight).toBeCloseTo(baseline.measurements.planeHeight * grow, 0);
  });

  it('reports growth in size with the shape unchanged', () => {
    expect(follow.measurements.cr).toBeCloseTo(baseline.measurements.cr, 0);
    expect(follow.measurements.headCircumferenceMm / baseline.measurements.headCircumferenceMm).toBeCloseTo(grow, 2);
  });
});
