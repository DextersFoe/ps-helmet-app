import { describe, expect, it } from 'vitest';
import { checkScanQuality } from '../src/measure/index.js';
import type { Landmarks } from '../src/measure/frame.js';
import type { Mesh } from '../src/measure/stl.js';
import { ellipsoid, merge } from './shapes.js';

// The same infant-sized head as measure.test.ts, facing +y, patient's left at -x.
const A = 64, B = 76, C = 90, CZ = 20;
const k = Math.sqrt(1 - (CZ / C) ** 2);
const lm: Landmarks = { sellion: [0, B * k, 0], tragionLeft: [-A * k, 0, 0], tragionRight: [A * k, 0, 0] };
const head = ellipsoid(A, B, C, CZ, 0, 120);
const check = (m: Mesh, firstScan = true) => checkScanQuality(m, lm, { firstScan });
const byId = (r: ReturnType<typeof check>, id: string) => r.checks.find((c) => c.id === id)!;

/** Leaves out the triangles whose centre lies in a small region. */
function withHole(m: Mesh, keep: (c: [number, number, number]) => boolean): Mesh {
  const out: number[] = [];
  for (let f = 0; f < m.triangleCount; f++) {
    const t = m.triangles.subarray(f * 9, f * 9 + 9);
    if (keep([(t[0]! + t[3]! + t[6]!) / 3, (t[1]! + t[4]! + t[7]!) / 3, (t[2]! + t[5]! + t[8]!) / 3])) out.push(...t);
  }
  return { triangles: Float64Array.from(out), triangleCount: out.length / 9 };
}

const shift = (m: Mesh, dy: number): Mesh => {
  const t = Float64Array.from(m.triangles);
  for (let i = 1; i < t.length; i += 3) t[i]! += dy;
  return { triangles: t, triangleCount: m.triangleCount };
};

describe('scan quality', () => {
  it('passes a closed surface for holes, peel and loose pieces', () => {
    const r = check(head);
    expect(byId(r, 'holes').ok).toBe(true);
    expect(byId(r, 'peel').ok).toBe(true);
    expect(byId(r, 'fragments').ok).toBe(true);
  });

  it('fails a smooth face with no features, and the missing ears', () => {
    const r = check(head);
    expect(byId(r, 'face').ok).toBe(false);
    expect(byId(r, 'ears').ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('finds facial detail when a nose stands out', () => {
    // A dense nose: the depth map samples the scan's points, as on a real scan.
    const nose = shift(ellipsoid(9, 14, 16, -20, 0, 60), B * k - 4);
    expect(byId(check(merge(head, nose)), 'face').ok).toBe(true);
  });

  it('finds a hole on the back of the head and says where it is', () => {
    const r = check(withHole(head, ([x, y, z]) => Math.hypot(x, z - 60) > 10 || y > 0));
    const holes = byId(r, 'holes');
    expect(holes.ok).toBe(false);
    expect(holes.detail).toContain('back of the head');
    expect(r.holeLoops.length).toBe(1);
  });

  it('finds peel: a loose layer lying just off the surface', () => {
    const flap = withHole(ellipsoid(A + 1.5, B + 1.5, C + 1.5, CZ, 0, 120), ([x, y, z]) => Math.hypot(x, z - 70) < 18 && y < 0);
    const r = check(merge(head, flap));
    expect(byId(r, 'peel').ok).toBe(false);
    expect(r.peelTriangles.length).toBeGreaterThan(0);
  });

  it('asks for a rescan on a first scan, and only flags a follow-up', () => {
    expect(check(head, true).verdict).toMatch(/please rescan/);
    const f = check(head, false);
    expect(f.verdict).toMatch(/flagged/);
    expect(f.verdict).toMatch(/not required/);
  });
});
