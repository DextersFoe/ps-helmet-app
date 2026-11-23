/**
 * Top-down drawing of head outlines at the measurement level, as an SVG string.
 * Coordinates are head-frame [left, forward] in mm. Drawn face up, with the
 * patient's left on the left of the picture (as seen from above and behind).
 */
import type { Vec2 } from '../src/measure/vec.js';

export interface OutlineLayer {
  points: Vec2[];
  colour: string;
  dashed?: boolean;
  fill?: string;
  width?: number;
  /** Draw the two 30-degree diagonals of this outline. */
  diagonals?: boolean;
}

function rayExit(poly: Vec2[], o: Vec2, d: Vec2): number {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0], ey = b[1] - a[1], den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = a[0] - o[0], ay = a[1] - o[1];
    const t = (ax * ey - ay * ex) / den, s = (ax * d[1] - ay * d[0]) / den;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t > best) best = t;
  }
  return best;
}

export function shapeSvg(layers: OutlineLayer[], opts: { width?: number; height?: number } = {}): string {
  const W = opts.width ?? 440, H = opts.height ?? 400;
  const all = layers.flatMap((l) => l.points);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const sc = Math.min(W - 70, H - 50) / span;
  const X = (p: Vec2) => W / 2 - (p[0] - cx) * sc;
  const Y = (p: Vec2) => H / 2 - (p[1] - cy) * sc;
  const path = (pts: Vec2[]) => 'M' + pts.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' L') + ' Z';
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Mulish, Helvetica, Arial, sans-serif" font-size="12">`];
  out.push(`<rect width="${W}" height="${H}" fill="#f3f2ed"/>`);
  for (const l of layers) {
    out.push(`<path d="${path(l.points)}" fill="${l.fill ?? 'none'}" stroke="${l.colour}" stroke-width="${l.width ?? 1.8}"${l.dashed ? ' stroke-dasharray="5 4"' : ''}/>`);
    if (l.diagonals) {
      const lx = l.points.map((p) => p[0]), ly = l.points.map((p) => p[1]);
      const c: Vec2 = [(Math.min(...lx) + Math.max(...lx)) / 2, (Math.min(...ly) + Math.max(...ly)) / 2];
      for (const ang of [30, -30]) {
        const r = (ang * Math.PI) / 180, d: Vec2 = [Math.sin(r), Math.cos(r)];
        const a = rayExit(l.points, c, d), b = rayExit(l.points, c, [-d[0], -d[1]]);
        const p1: Vec2 = [c[0] + d[0] * a, c[1] + d[1] * a], p2: Vec2 = [c[0] - d[0] * b, c[1] - d[1] * b];
        out.push(`<line x1="${X(p1).toFixed(1)}" y1="${Y(p1).toFixed(1)}" x2="${X(p2).toFixed(1)}" y2="${Y(p2).toFixed(1)}" stroke="${l.colour}" stroke-width="1" stroke-dasharray="3 3"/>`);
      }
    }
  }
  out.push(`<text x="${W / 2}" y="16" text-anchor="middle" fill="#737373">Front</text>`);
  out.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#737373">Back</text>`);
  out.push(`<text x="8" y="${H / 2 + 4}" fill="#737373">Left</text>`);
  out.push(`<text x="${W - 8}" y="${H / 2 + 4}" text-anchor="end" fill="#737373">Right</text>`);
  out.push('</svg>');
  return out.join('');
}
