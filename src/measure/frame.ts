/**
 * Head reference frames.
 *
 * tragionFrame: from sellion and the left and right tragion.
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
  /** Otobasion superius: where the top of each ear joins the scalp. */
  earTopLeft?: Vec3;
  earTopRight?: Vec3;
}

export interface HeadFrame {
  origin: Vec3;
  left: Vec3;
  forward: Vec3;
  up: Vec3;
}

export function tragionFrame(landmarks: Landmarks): HeadFrame {
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

/**
 * The measurement frame. With both ear tops (clinic choice, Nov 2026), the
 * reference plane passes through sellion and the midpoint of the two ear tops
 * and is levelled side to side on the tragion axis, so a difference in ear
 * height does not tilt it. Origin: the ear-top midpoint. Without ear tops,
 * the tragion frame is used.
 */
export function buildFrame(landmarks: Landmarks): HeadFrame {
  const { earTopLeft, earTopRight } = landmarks;
  const base = tragionFrame(landmarks);
  if (!earTopLeft || !earTopRight) return base;
  if (length(sub(earTopLeft, earTopRight)) < 40) {
    throw new Error('The two ear-top landmarks are less than 40 mm apart; check their placement');
  }
  const origin = midpoint(earTopLeft, earTopRight);
  // As in the tragion frame, forward points from the ear midpoint to sellion; the
  // plane also contains the tragion left-right axis, which levels it side to side.
  const forward = normalize(sub(landmarks.sellion, origin));
  const up = normalize(cross(forward, base.left));
  return { origin, left: normalize(cross(up, forward)), forward, up };
}

/** Coordinates of a point in the head frame: [left, forward, up], in mm. */
export function toFrame(frame: HeadFrame, p: Vec3): Vec3 {
  const d = sub(p, frame.origin);
  return [dot(d, frame.left), dot(d, frame.forward), dot(d, frame.up)];
}
