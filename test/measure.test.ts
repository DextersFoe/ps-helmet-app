import { describe, expect, it } from 'vitest';
import { buildFrame, findEarTops, measureHead, parseStl, toFrame, tragionFrame } from '../src/measure/index.js';
import type { Landmarks } from '../src/measure/frame.js';
import { box, ellipseDiameter, ellipsePerimeter, ellipsoid, merge, toBinaryStl } from './shapes.js';

// An infant-sized head: 70 mm half-width, 80 mm half-length, 90 mm tall above
// its centre. The centre sits 20 mm above the ear plane (z = 0), so the widest
// level is 20 mm above the reference plane, as on a real head.
const A = 64;
const B = 76;
const C = 90;
const CZ = 20;
const atEarLevel = Math.sqrt(1 - (CZ / C) ** 2);

/**
 * Landmarks on the ear plane (z = 0) of an unrotated ellipsoid. The head faces
 * +y with the crown at +z, so the patient's left is -x.
 */
const landmarks = (shiftLeftEarForward = 0): Landmarks => ({
  sellion: [0, B * atEarLevel, 0],
  tragionLeft: [-A * atEarLevel, shiftLeftEarForward / 2, 0],
  tragionRight: [A * atEarLevel, -shiftLeftEarForward / 2, 0],
});

describe('measureHead on a symmetric head', () => {
  const m = measureHead(ellipsoid(A, B, C, CZ), landmarks());

  it('finds the widest level', () => {
    expect(m.planeHeight).toBeCloseTo(CZ, 0);
  });

  it('measures length, width and cephalic ratio', () => {
    expect(m.lengthMm).toBeCloseTo(2 * B, 1);
    expect(m.widthMm).toBeCloseTo(2 * A, 1);
    expect(m.cr).toBeCloseTo((A / B) * 100, 1);
  });

  it('measures head circumference', () => {
    expect(m.headCircumferenceMm).toBeCloseTo(ellipsePerimeter(A, B), 0);
  });

  it('finds no asymmetry', () => {
    expect(m.cvai).toBeLessThan(0.05);
    expect(m.posteriorFlatSide).toBe('none');
    expect(m.earForward).toBe('none');
  });
});

describe('measureHead on an asymmetric head', () => {
  // Turning the outline 10 degrees makes one diagonal longer than the other,
  // like posterior flattening on one side.
  const rotDeg = 10;
  const rot = (rotDeg * Math.PI) / 180;
  const mesh = ellipsoid(A, B, C, CZ, rotDeg);
  // Put the landmarks where the turned surface crosses the left-right and forward axes.
  const r = (theta: number) => ellipseDiameter(A, B, rot, theta) / 2;
  const lm: Landmarks = {
    sellion: [0, r(Math.PI / 2) * atEarLevel, 0],
    tragionLeft: [-r(0) * atEarLevel, 0, 0],
    tragionRight: [r(0) * atEarLevel, 0, 0],
  };
  const m = measureHead(mesh, lm, { planeHeight: CZ });

  // Diagonals at 30 degrees either side of the forward (+y) axis; the patient's left is -x.
  const frontLeft = ellipseDiameter(A, B, rot, Math.PI / 2 + Math.PI / 6);
  const frontRight = ellipseDiameter(A, B, rot, Math.PI / 2 - Math.PI / 6);

  it('measures both diagonals', () => {
    expect(m.diagonalFrontLeftMm).toBeCloseTo(frontLeft, 1);
    expect(m.diagonalFrontRightMm).toBeCloseTo(frontRight, 1);
  });

  it('computes CVA and CVAI against the longer diagonal', () => {
    const longer = Math.max(frontLeft, frontRight);
    const cva = Math.abs(frontLeft - frontRight);
    expect(m.cvaMm).toBeCloseTo(cva, 1);
    expect(m.cvai).toBeCloseTo((cva / longer) * 100, 1);
  });

  it('names the flattened side from the shorter diagonal', () => {
    // Turning the long axis anticlockwise (seen from above) towards the front-left
    // lengthens that diagonal, so the front-right/back-left diagonal is shorter:
    // left posterior flattening.
    expect(frontRight).toBeLessThan(frontLeft);
    expect(m.posteriorFlatSide).toBe('left');
  });
});

describe('ear shift', () => {
  it('reports how far forward one ear sits', () => {
    const m = measureHead(ellipsoid(A, B, C, CZ), landmarks(6));
    expect(m.earShiftMm).toBeCloseTo(6, 5);
    expect(m.earForward).toBe('left');
  });
});

describe('ears are kept out of the measurement plane', () => {
  // A 9 mm thick "ear" sticking out from each side, reaching 30 mm above the ear plane.
  const xs = A * atEarLevel; // both ears, so their side does not matter here
  const head = ellipsoid(A, B, C, CZ);
  const ears = merge(box([xs - 2, -12, -12], [xs + 9, 12, 30]), box([-xs - 9, -12, -12], [-xs + 2, 12, 30]));
  const m = measureHead(merge(head, ears), landmarks());

  it('measures above the ears', () => {
    expect(m.searchFromHeight).toBeGreaterThan(30);
    expect(m.planeHeight).toBeGreaterThan(30);
  });

  it('measures the skull, not the ears', () => {
    const k = Math.sqrt(1 - ((m.planeHeight - CZ) / C) ** 2);
    expect(m.widthMm).toBeCloseTo(2 * A * k, 0);
  });
});

describe('measurement plane from sellion and the ear tops', () => {
  const xs = A * atEarLevel;
  const head = ellipsoid(A, B, C, CZ);
  const withEars = merge(head, box([xs - 2, -12, -12], [xs + 9, 12, 30]), box([-xs - 9, -12, -12], [-xs + 2, 12, 30]));
  const k30 = A * Math.sqrt(1 - ((30 - CZ) / C) ** 2);

  it('finds both ear tops where the ears meet the scalp', () => {
    const { earTopLeft, earTopRight } = findEarTops(withEars, landmarks());
    expect(earTopLeft[2]).toBeCloseTo(30, 0);
    expect(earTopRight[2]).toBeCloseTo(30, 0);
    // On the scalp (patient's left is -x here), within the ear's front-to-back span.
    expect(Math.abs(earTopLeft[0] + k30)).toBeLessThan(1.5);
    expect(Math.abs(earTopRight[0] - k30)).toBeLessThan(1.5);
    expect(Math.abs(earTopLeft[1])).toBeLessThan(12);
  });

  it('passes through sellion and the ear tops', () => {
    const lm = { ...landmarks(), earTopLeft: [-k30, 0, 30] as [number, number, number], earTopRight: [k30, 0, 30] as [number, number, number] };
    const f = buildFrame(lm);
    expect(toFrame(f, lm.sellion)[2]).toBeCloseTo(0, 6);
    expect(toFrame(f, lm.earTopLeft)[2]).toBeCloseTo(0, 6);
    expect(toFrame(f, lm.earTopRight)[2]).toBeCloseTo(0, 6);
    // Rises towards the back: a point behind the ears is above the tragion plane.
    expect(f.up[1]).toBeGreaterThan(0.2);
  });

  it('stays level side to side when one ear sits higher', () => {
    const lm = { ...landmarks(), earTopLeft: [-k30, 0, 25] as [number, number, number], earTopRight: [k30, 0, 35] as [number, number, number] };
    const f = buildFrame(lm), t = tragionFrame(lm);
    expect(f.left[0] * t.left[0] + f.left[1] * t.left[1] + f.left[2] * t.left[2]).toBeCloseTo(1, 6);
    expect(toFrame(f, lm.sellion)[2]).toBeCloseTo(0, 6);
    expect(toFrame(f, [0, 0, 30])[2]).toBeCloseTo(0, 6); // the ear-top midpoint
  });

  it('measures a symmetric head as symmetric', () => {
    const m = measureHead(withEars, { ...landmarks(), ...findEarTops(withEars, landmarks()) });
    expect(m.cvai).toBeLessThan(0.3);
    expect(m.planeHeight).toBeGreaterThan(0);
  });
});

describe('landmark checks', () => {
  it('rejects swapped ear landmarks', () => {
    const lm = landmarks();
    expect(() =>
      measureHead(ellipsoid(A, B, C, CZ), { ...lm, tragionLeft: lm.tragionRight, tragionRight: lm.tragionLeft }),
    ).toThrow(/swapped/);
  });

  it('rejects ear landmarks placed too close together', () => {
    expect(() =>
      measureHead(ellipsoid(A, B, C, CZ), { sellion: [0, 70, 0], tragionLeft: [10, 0, 0], tragionRight: [-10, 0, 0] }),
    ).toThrow(/40 mm/);
  });
});

describe('STL loading', () => {
  const mesh = ellipsoid(A, B, C, CZ, 0, 48);

  it('reads binary STL', () => {
    const parsed = parseStl(toBinaryStl(mesh));
    expect(parsed.triangleCount).toBe(mesh.triangleCount);
    expect(parsed.triangles[5]).toBeCloseTo(mesh.triangles[5]!, 4);
  });

  it('reads ASCII STL', () => {
    const t = mesh.triangles;
    let text = 'solid test\n';
    for (let i = 0; i < mesh.triangleCount; i++) {
      text += 'facet normal 0 0 0\nouter loop\n';
      for (let k = 0; k < 3; k++) text += `vertex ${t[i * 9 + k * 3]} ${t[i * 9 + k * 3 + 1]} ${t[i * 9 + k * 3 + 2]}\n`;
      text += 'endloop\nendfacet\n';
    }
    text += 'endsolid test\n';
    const parsed = parseStl(new TextEncoder().encode(text));
    expect(parsed.triangleCount).toBe(mesh.triangleCount);
  });

  it('rejects files that are not STL', () => {
    expect(() => parseStl(new TextEncoder().encode('hello'))).toThrow();
  });
});
