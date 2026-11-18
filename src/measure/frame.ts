/**
 * Head reference frame, built from the three landmarks in the pilot spec:
 * sellion and the left and right tragion.
 *
 * - Origin: midpoint of the two tragions.
 * - Reference plane: the plane through sellion and both tragions.
 * - forward (y): from the origin towards sellion. Together with "up" this spans
 *   the midsagittal plane, which passes through sellion and the tragion midpoint.
 * - up (z): normal to the reference plane, towards the crown.
 * - left (x): towards the patient's left. Seen from above, with forward pointing
 *   up the page, left points to the left of the page.
 */
import { type Vec3, cross, dot, length, midpoint, normalize, sub } from './vec.js';

export interface Landmarks {
  sellion: Vec3;
  tragionLeft: Vec3;
  tragionRight: Vec3;
}

export interface HeadFrame {
  origin: Vec3;
  left: Vec3;
  forward: Vec3;
  up: Vec3;
}

export function buildFrame(landmarks: Landmarks): HeadFrame {
  const { sellion, tragionLeft, tragionRight } = landmarks;
  if (length(sub(tragionLeft, tragionRight)) < 40) {
    throw new Error('The two ear landmarks are less than 40 mm apart; check their placement');
  }
  const origin = midpoint(tragionLeft, tragionRight);
  if (length(sub(sellion, origin)) < 30) {
    throw new Error('Sellion is less than 30 mm from the ear midpoint; check its placement');
  }
  const forward = normalize(sub(sellion, origin));
  const leftRaw = sub(tragionLeft, tragionRight);
  // Anatomically, forward x left = up and up x forward = left.
  // (Facing north with up to the sky, left is west: north x west = up.)
  const up = normalize(cross(forward, leftRaw));
  const left = normalize(cross(up, forward));
  return { origin, left, forward, up };
}

/** Coordinates of a point in the head frame: [left, forward, up], in mm. */
export function toFrame(frame: HeadFrame, p: Vec3): Vec3 {
  const d = sub(p, frame.origin);
  return [dot(d, frame.left), dot(d, frame.forward), dot(d, frame.up)];
}
