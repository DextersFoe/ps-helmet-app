/**
 * Head measurements as defined in the pilot spec ("Measurement definitions").
 *
 * 1. Build the head frame from sellion and both tragions.
 * 2. Find the measurement plane: parallel to the reference plane, at the
 *    height where head circumference is largest.
 * 3. On that plane's outline: length, width, CR, the two 30-degree diagonals,
 *    CVA, CVAI and head circumference.
 * 4. Ear shift from the tragion positions.
 */
import { type HeadFrame, type Landmarks, buildFrame, toFrame } from './frame.js';
import { convexHull, perimeter, rayExit } from './hull.js';
import { type CrLevel, type Graded, type Level, gradeCr, gradeCvai } from './severity.js';
import { type FramedMesh, frameMesh, sliceSegments, slicePieces } from './slice.js';
import type { Mesh } from './stl.js';
import type { Vec2, Vec3 } from './vec.js';

export const ENGINE_VERSION = '0.1.0';

export interface MeasureOptions {
  /** Fixed measurement height above the reference plane, mm. Omit to search for the largest circumference. */
  planeHeight?: number;
  /** Search range as fractions of the head's height above the reference plane. */
  searchFrom?: number;
  searchTo?: number;
  /** Diagonal angle from the front-to-back axis, degrees. */
  diagonalAngle?: number;
}

export interface Measurements {
  engineVersion: string;
  landmarks: Landmarks;
  frame: HeadFrame;
  /** Height of the measurement plane above the reference plane, mm. */
  planeHeight: number;
  /** Lowest height searched, mm: just above the detected top of the ears. */
  searchFromHeight: number;
  /** Outline used for measuring (convex hull), head-frame [left, forward] mm. */
  outline: Vec2[];
  lengthMm: number;
  widthMm: number;
  /** Cephalic ratio, %. */
  cr: number;
  /** Diagonal from front-left to back-right, mm. */
  diagonalFrontLeftMm: number;
  /** Diagonal from front-right to back-left, mm. */
  diagonalFrontRightMm: number;
  /** Cranial vault asymmetry: longer minus shorter diagonal, mm. */
  cvaMm: number;
  /** Cranial vault asymmetry index, % (divided by the longer diagonal). */
  cvai: number;
  /** Side of posterior flattening implied by the shorter diagonal. */
  posteriorFlatSide: 'left' | 'right' | 'none';
  headCircumferenceMm: number;
  /** Front-to-back ear offset, mm. Positive: left ear further forward. */
  earShiftMm: number;
  earForward: 'left' | 'right' | 'none';
  cvaiGrade: Graded<Level>;
  crGrade: Graded<CrLevel>;
}

interface PlaneResult {
  height: number;
  hull: Vec2[];
  circumference: number;
}

function measurePlane(fm: FramedMesh, height: number): PlaneResult | null {
  const pieces = slicePieces(sliceSegments(fm, height));
  const main = pieces[0];
  if (!main || main.length < 6) return null;
  const hull = convexHull(main);
  return { height, hull, circumference: perimeter(hull) };
}

/**
 * Height above the reference plane where the ears end.
 *
 * Slices that cut through an ear are wider on that side than the skull. As the
 * slices pass the top of the ear, that side's extent drops suddenly. The
 * highest such drop on either side is taken as the top of the ears.
 */
export function findEarTop(fm: FramedMesh, maxSearch: number, jumpMm = 2.5): number {
  let earTop = 0;
  let prev: { left: number; right: number } | null = null;
  for (let h = 0; h <= maxSearch; h += 1) {
    const main = slicePieces(sliceSegments(fm, h))[0];
    if (!main) continue;
    let left = -Infinity;
    let right = Infinity;
    for (const p of main) {
      if (p[0] > left) left = p[0];
      if (p[0] < right) right = p[0];
    }
    if (prev && (prev.left - left > jumpMm || right - prev.right > jumpMm)) earTop = h;
    prev = { left, right };
  }
  return earTop;
}

function findMeasurementPlane(fm: FramedMesh, opts: MeasureOptions): PlaneResult & { searchFrom: number } {
  if (opts.planeHeight !== undefined) {
    const fixed = measurePlane(fm, opts.planeHeight);
    if (!fixed) throw new Error(`The scan has no outline at ${opts.planeHeight} mm above the reference plane`);
    return { ...fixed, searchFrom: opts.planeHeight };
  }
  const to = (opts.searchTo ?? 0.7) * fm.maxUp;
  const from =
    opts.searchFrom !== undefined ? opts.searchFrom * fm.maxUp : Math.min(findEarTop(fm, 0.5 * fm.maxUp) + 2, to);
  let best: PlaneResult | null = null;
  const consider = (h: number) => {
    if (h < from || h > to) return;
    const r = measurePlane(fm, h);
    if (r && (!best || r.circumference > best.circumference)) best = r;
  };
  for (let h = from; h <= to; h += 1) consider(h);
  if (!best) throw new Error('Could not find the head outline above the reference plane');
  const coarse: number = (best as PlaneResult).height;
  for (let h = coarse - 1; h <= coarse + 1; h += 0.1) consider(h);
  return { ...(best as PlaneResult), searchFrom: from };
}

export function measureHead(mesh: Mesh, landmarks: Landmarks, opts: MeasureOptions = {}): Measurements {
  const frame = buildFrame(landmarks);
  const fm = frameMesh(mesh, frame);
  // The cranial vault rises further above the ear plane than the chin and neck
  // fall below it. If not, "up" is pointing down: the ears are swapped.
  if (fm.maxUp < 40 || fm.maxUp < fm.maxDown) {
    throw new Error(
      'Very little of the scan lies above the ear plane. Check that the left and right ear landmarks are not swapped.',
    );
  }
  const plane = findMeasurementPlane(fm, opts);
  const hull = plane.hull;

  const xs = hull.map((p) => p[0]);
  const ys = hull.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const lengthMm = yMax - yMin;
  const widthMm = xMax - xMin;
  const centre: Vec2 = [(xMin + xMax) / 2, (yMin + yMax) / 2];

  const angle = ((opts.diagonalAngle ?? 30) * Math.PI) / 180;
  const diagonal = (dir: Vec2) => rayExit(hull, centre, dir) + rayExit(hull, centre, [-dir[0], -dir[1]]);
  // x is the patient's left, y is forward.
  const diagonalFrontLeftMm = diagonal([Math.sin(angle), Math.cos(angle)]);
  const diagonalFrontRightMm = diagonal([-Math.sin(angle), Math.cos(angle)]);
  const longer = Math.max(diagonalFrontLeftMm, diagonalFrontRightMm);
  const cvaMm = Math.abs(diagonalFrontLeftMm - diagonalFrontRightMm);
  const cvai = (cvaMm / longer) * 100;
  // A short front-left/back-right diagonal means the back-right is flattened.
  const posteriorFlatSide =
    cvaMm < 0.05 ? 'none' : diagonalFrontLeftMm < diagonalFrontRightMm ? 'right' : 'left';

  const tl = toFrame(frame, landmarks.tragionLeft);
  const tr = toFrame(frame, landmarks.tragionRight);
  const earShiftMm = tl[1] - tr[1];
  const earForward = Math.abs(earShiftMm) < 0.05 ? 'none' : earShiftMm > 0 ? 'left' : 'right';

  const cr = (widthMm / lengthMm) * 100;
  return {
    engineVersion: ENGINE_VERSION,
    landmarks,
    frame,
    planeHeight: plane.height,
    searchFromHeight: plane.searchFrom,
    outline: hull,
    lengthMm,
    widthMm,
    cr,
    diagonalFrontLeftMm,
    diagonalFrontRightMm,
    cvaMm,
    cvai,
    posteriorFlatSide,
    headCircumferenceMm: plane.circumference,
    earShiftMm,
    earForward,
    cvaiGrade: gradeCvai(cvai),
    crGrade: gradeCr(cr),
  };
}

/** Distance from a landmark to the nearest mesh vertex, mm: flags landmarks placed off the scan. */
export function distanceToSurface(mesh: Mesh, p: Vec3): number {
  const t = mesh.triangles;
  let best = Infinity;
  for (let i = 0; i < t.length; i += 3) {
    const d = Math.hypot(t[i]! - p[0], t[i + 1]! - p[1], t[i + 2]! - p[2]);
    if (d < best) best = d;
  }
  return best;
}

