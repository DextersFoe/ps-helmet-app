import { readFileSync } from 'node:fs';
import { parseStl, buildFrame, measureHead } from '../src/measure/index.js';
import { measureFollowUp } from '../src/measure/followup.js';
const base = parseStl(readFileSync(process.argv[2]!)); const lm = JSON.parse(readFileSync(process.argv[4]!, 'utf8'));
const m0 = measureHead(base, lm);
for (const f of process.argv[3]!.split(',')) {
  const fu = parseStl(readFileSync(f)); const t0 = Date.now();
  const r = measureFollowUp({ mesh: base, landmarks: lm, measurements: m0 }, fu);
  const m = r.measurements;
  console.log(f.split('/').pop(), 'scale', r.transform.scale.toFixed(4), 'resid', r.medianResidualMm.toFixed(2), 'ms', Date.now()-t0,
    '| plane', m.planeHeight.toFixed(1), 'CR', m.cr.toFixed(1), 'CVAI', m.cvai.toFixed(1), 'HC', m.headCircumferenceMm.toFixed(1), 'ear', m.earShiftMm.toFixed(1));
}
console.log('base plane', m0.planeHeight.toFixed(1), 'CR', m0.cr.toFixed(1), 'CVAI', m0.cvai.toFixed(1), 'HC', m0.headCircumferenceMm.toFixed(1), 'ear', m0.earShiftMm.toFixed(1));
