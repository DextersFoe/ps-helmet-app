/**
 * Proposes the two ear-top landmarks (otobasion superius: where the top of the
 * ear joins the scalp) from the scan shape. The clinician confirms them.
 *
 * Working up from the tragion plane, each side's outline sticks out where the
 * ear is. The ear top is the highest level where that side's extent drops
 * inward by more than `dropMm` within 2 mm of height. The landmark is the scalp
 * point just above it, at the ear's front-to-back position.
 */
import { type Landmarks, toFrame, tragionFrame } from './frame.js';
import { frameMesh, sliceSegments, slicePieces } from './slice.js';
import type { Mesh } from './stl.js';
import type { Vec2, Vec3 } from './vec.js';

export function findEarTops(mesh: Mesh, landmarks: Landmarks, dropMm = 2.5): { earTopLeft: Vec3; earTopRight: Vec3 } {
  const frame = tragionFrame(landmarks);
  const fm = frameMesh(mesh, frame);
  const step = 0.5, window = 4; // 4 steps = 2 mm
  const levels: { h: number; pts: Vec2[] }[] = [];
  for (let h = 0; h <= 0.5 * fm.maxUp; h += step) {
    const main = slicePieces(sliceSegments(fm, h))[0];
    if (main) levels.push({ h, pts: main });
  }
  const { origin: o, left: l, forward: f, up: u } = frame;
  const at = (p: Vec3, i: 0 | 1 | 2) => o[i] + p[0] * l[i] + p[1] * f[i] + p[2] * u[i];
  const toWorld = (p: Vec3): Vec3 => [at(p, 0), at(p, 1), at(p, 2)];

  const side = (sign: 1 | -1, tragion: Vec3): Vec3 => {
    const ty = toFrame(frame, tragion)[1];
    // Extent on this side, near the ear front to back.
    const ext = levels.map(({ pts }) => {
      let best = -Infinity, y = ty;
      for (const p of pts) {
        if (Math.abs(p[1] - ty) < 35 && p[0] * sign > best) { best = p[0] * sign; y = p[1]; }
      }
      return { best, y };
    });
    const drops = (i: number) => ext[i - window]!.best - ext[i]!.best > dropMm;
    let end = -1;
    for (let i = window; i < levels.length; i++) if (drops(i)) end = i;
    if (end < 0) throw new Error(`Could not find the top of the ${sign > 0 ? 'left' : 'right'} ear; place it by hand`);
    let start = end;
    while (start > window && drops(start - 1)) start--;
    // Within the last drop, the level with the sharpest single step inward.
    let top = end;
    for (let j = Math.max(1, start - window + 1); j <= end; j++) {
      if (ext[j - 1]!.best - ext[j]!.best > ext[top - 1]!.best - ext[top]!.best) top = j;
    }
    // Ear position: the extreme point a little below the drop. Scalp point: on the level of the drop.
    const earY = ext[Math.max(0, top - window)]!.y;
    let best: Vec2 | undefined;
    for (const p of levels[top]!.pts) {
      if (p[0] * sign > 20 && (!best || Math.abs(p[1] - earY) < Math.abs(best[1] - earY))) best = p;
    }
    return toWorld([best![0], best![1], levels[top]!.h]);
  };
  return { earTopLeft: side(1, landmarks.tragionLeft), earTopRight: side(-1, landmarks.tragionRight) };
}
