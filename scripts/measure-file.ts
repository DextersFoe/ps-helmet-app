/**
 * Measure a head scan from the command line.
 *
 *   npm run measure -- <scan.stl> <landmarks.json> [--height <mm>]
 *
 * landmarks.json: {"sellion":[x,y,z],"tragionLeft":[x,y,z],"tragionRight":[x,y,z]} in scan coordinates (mm).
 * Scans stay on your machine; never commit them to the repository.
 */
import { readFileSync } from 'node:fs';
import { bounds, distanceToSurface, measureHead, parseStl, type Landmarks } from '../src/measure/index.js';

const [scanPath, landmarksPath, ...rest] = process.argv.slice(2);
if (!scanPath || !landmarksPath) {
  console.error('Usage: npm run measure -- <scan.stl> <landmarks.json> [--height <mm>]');
  process.exit(1);
}
const heightIdx = rest.indexOf('--height');
const planeHeight = heightIdx >= 0 ? Number(rest[heightIdx + 1]) : undefined;

const mesh = parseStl(readFileSync(scanPath));
const landmarks = JSON.parse(readFileSync(landmarksPath, 'utf8')) as Landmarks;
const { min, max } = bounds(mesh);
const size = max.map((v, i) => v - min[i]!);
console.log(`Triangles: ${mesh.triangleCount}; size ${size.map((v) => v.toFixed(1)).join(' x ')} mm`);
for (const [name, p] of Object.entries(landmarks)) {
  console.log(`  ${name}: ${distanceToSurface(mesh, p).toFixed(1)} mm from the scan surface`);
}
const m = measureHead(mesh, landmarks, planeHeight === undefined ? {} : { planeHeight });
const f = (v: number) => v.toFixed(1);
console.log(`
Measurement plane: ${f(m.planeHeight)} mm above the reference plane (searched from ${f(m.searchFromHeight)} mm, above the ears)
Length:   ${f(m.lengthMm)} mm
Width:    ${f(m.widthMm)} mm
CR:       ${f(m.cr)} %  (${m.crGrade.level})
Diagonal front-left to back-right: ${f(m.diagonalFrontLeftMm)} mm
Diagonal front-right to back-left: ${f(m.diagonalFrontRightMm)} mm
CVA:      ${f(m.cvaMm)} mm
CVAI:     ${f(m.cvai)} %  (${m.cvaiGrade.level}; posterior flattening: ${m.posteriorFlatSide})
HC:       ${f(m.headCircumferenceMm)} mm
Ear shift: ${f(Math.abs(m.earShiftMm))} mm (${m.earForward} ear further forward)
Engine:   ${m.engineVersion}`);
