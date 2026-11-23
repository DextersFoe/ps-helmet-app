/** Plain-language PDF for the clinician to share with the family. */
import { jsPDF } from 'jspdf';

export interface FamilyScanRow {
  date: string; // display date
  cvai: number;
  cvaiLevel: string;
  cr: number;
  crLevel: string;
  circumferenceMm: number;
}

export interface FamilyReportInput {
  childName: string;
  clinician: string;
  clinic: string;
  preparedOn: string;
  scans: FamilyScanRow[];
  shapePng: string; // data URL
  shapeKey: { label: string; colour: string; dashed?: boolean }[];
  viewPng: string; // data URL
  fileName: string;
}

const NAVY: [number, number, number] = [62, 74, 102];
const MUTED: [number, number, number] = [93, 103, 121];
const INK: [number, number, number] = [31, 42, 61];

const plainLevel = (level: string) =>
  ({
    Normal: 'within the typical range',
    Mild: 'in the mild range',
    Moderate: 'in the moderate range',
    Severe: 'in the severe range',
    'Very severe': 'in the very severe range',
    Scaphocephaly: 'narrower than typical (long and narrow)',
  })[level] ?? level.toLowerCase();

export function familyReport(input: FamilyReportInput): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18, CW = W - 2 * M;
  const who = input.childName.trim() ? `${input.childName.trim()}’s` : 'Your baby’s';
  const first = input.scans[0]!, last = input.scans.at(-1)!;

  const text = (s: string, x: number, y: number, size = 10.5, style: 'normal' | 'bold' = 'normal', colour = INK, maxWidth = CW) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...colour);
    const lines = doc.splitTextToSize(s, maxWidth) as string[];
    doc.text(lines, x, y);
    return y + lines.length * size * 0.42;
  };
  const footer = (page: number) => {
    doc.setDrawColor(217, 221, 227); doc.line(M, 284, W - M, 284);
    text('This report explains measurements taken from 3D scans of the head. Please talk it through with your clinician.', M, 288.5, 7.8, 'normal', MUTED);
    text(`Page ${page} of 2`, W - M - 14, 288.5, 7.8, 'normal', MUTED, 20);
  };

  // ---- Page 1 ----
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 30, 'F');
  text(`${who} head shape report`, M, 15, 18, 'bold', [255, 255, 255]);
  const by = [input.clinician.trim(), input.clinic.trim()].filter(Boolean).join(', ');
  text(`${by ? `Prepared by ${by} · ` : ''}${input.preparedOn}`, M, 23, 9.5, 'normal', [214, 219, 230]);

  let y = 42;
  y = text('Summary', M, y, 13, 'bold', NAVY) + 1;
  const parts = [
    `At the scan on ${last.date}, the asymmetry of the head (CVAI) is ${last.cvai.toFixed(1)}%, which is ${plainLevel(last.cvaiLevel)}. ` +
      `The width of the head compared with its length (cephalic ratio) is ${last.cr.toFixed(1)}%, which is ${plainLevel(last.crLevel)}.`,
  ];
  if (input.scans.length > 1) {
    const dc = last.cvai - first.cvai, dh = last.circumferenceMm - first.circumferenceMm;
    parts.push(
      `Since the first scan on ${first.date}, asymmetry has ${dc < -0.05 ? 'improved' : dc > 0.05 ? 'increased' : 'stayed about the same'}, ` +
        `from ${first.cvai.toFixed(1)}% to ${last.cvai.toFixed(1)}%, and the head has grown ${Math.abs(dh).toFixed(0)} mm around at the measured level.`,
    );
  }
  for (const p of parts) y = text(p, M, y + 1.5, 10.5) + 1;

  y += 5;
  y = text('Measurements', M, y, 13, 'bold', NAVY) + 2;
  const cols = [M, M + 34, M + 72, M + 124];
  doc.setFillColor(79, 120, 145); doc.rect(M, y - 4.5, CW, 7, 'F');
  ['Scan date', 'Head size around', 'Asymmetry (CVAI)', 'Width to length (CR)'].forEach((h, i) => text(h, cols[i]! + 2, y, 9, 'bold', [255, 255, 255], 52));
  y += 7;
  for (const s of input.scans) {
    text(s.date, cols[0]! + 2, y, 9.5);
    text(`${s.circumferenceMm.toFixed(0)} mm`, cols[1]! + 2, y, 9.5);
    text(`${s.cvai.toFixed(1)}%  ·  ${s.cvaiLevel}`, cols[2]! + 2, y, 9.5);
    text(`${s.cr.toFixed(1)}%  ·  ${s.crLevel}`, cols[3]! + 2, y, 9.5);
    doc.setDrawColor(217, 221, 227); doc.line(M, y + 2.5, W - M, y + 2.5);
    y += 7;
  }
  text('Head size is measured around the head at a fixed place, a little above the eyebrows and ears. It may differ slightly from a tape measurement.', M, y + 1, 8.3, 'normal', MUTED);

  y += 10;
  const imgW = (CW - 6) / 2;
  text('Head shape from above', M, y, 10, 'bold', NAVY);
  text('3D view', M + imgW + 6, y, 10, 'bold', NAVY);
  y += 3;
  doc.addImage(input.shapePng, 'JPEG', M, y, imgW, imgW * (400 / 440));
  doc.addImage(input.viewPng, 'JPEG', M + imgW + 6, y, imgW, imgW * (400 / 440));
  let ky = y + imgW * (400 / 440) + 5;
  let kx = M;
  for (const k of input.shapeKey) {
    const rgb = k.colour.match(/\w\w/g)!.map((h) => parseInt(h, 16)) as [number, number, number];
    doc.setDrawColor(...rgb); doc.setLineWidth(0.6);
    if (k.dashed) doc.setLineDashPattern([1.2, 1], 0); else doc.setLineDashPattern([], 0);
    doc.line(kx, ky - 1, kx + 6, ky - 1);
    doc.setLineDashPattern([], 0); doc.setLineWidth(0.2);
    text(k.label, kx + 8, ky, 8.5, 'normal', MUTED, 60);
    kx += 8 + doc.getTextWidth(k.label) + 8;
    if (kx > M + imgW - 10) { kx = M; ky += 5; }
  }
  footer(1);

  // ---- Page 2 ----
  doc.addPage();
  y = 22;
  y = text('Understanding the measurements', M, y, 15, 'bold', NAVY) + 3;
  y = text('Asymmetry (CVAI)', M, y, 11.5, 'bold', INK) + 0.5;
  y = text('Compares the two diagonal measurements across the top of the head. When one side at the back is flatter, one diagonal is shorter than the other. Lower numbers mean a more even shape.', M, y, 10) + 2;
  y = text('Width to length (cephalic ratio, CR)', M, y, 11.5, 'bold', INK) + 0.5;
  y = text('Compares how wide the head is with how long it is from front to back. A high number means the head is wide and short, which happens when the whole back of the head is flatter.', M, y, 10) + 4;

  const bands: [string, string, string][] = [
    ['Typical range', 'up to 3.5%', '75% to 90%'],
    ['Mild', '3.5% to 6.25%', '90% to 95%'],
    ['Moderate', '6.25% to 8.75%', '95% to 100%'],
    ['Severe', '8.75% to 11%', '100% to 105%'],
    ['Very severe', 'over 11%', 'over 105%'],
  ];
  doc.setFillColor(79, 120, 145); doc.rect(M, y - 4.5, CW, 7, 'F');
  ['Level', 'Asymmetry (CVAI)', 'Width to length (CR)'].forEach((h, i) => text(h, M + 2 + i * 58, y, 9, 'bold', [255, 255, 255], 55));
  y += 7;
  for (const b of bands) {
    b.forEach((c, i) => text(c, M + 2 + i * 58, y, 9.5));
    doc.setDrawColor(217, 221, 227); doc.line(M, y + 2.5, W - M, y + 2.5);
    y += 7;
  }
  y = text('A cephalic ratio under 75% means the head is long and narrow; your clinician will talk this through with you if it applies.', M, y + 1, 8.5, 'normal', MUTED) + 6;

  // Usual approach for each level, from the Printed Symmetry clinician reference.
  y = text('What the levels usually mean', M, y, 11.5, 'bold', INK) + 1;
  const usual: [string, string][] = [
    ['Typical range', 'No treatment is needed.'],
    ['Mild or moderate', 'Changing your baby’s position (repositioning) and plenty of supervised tummy time come first. Babies under 5 months are usually checked again after a month. A helmet is an option if you choose it. When the width-to-length level is moderate, a helmet is usually recommended, depending on age and history.'],
    ['Severe', 'For asymmetry: repositioning, with a helmet if you choose it. For width to length: a helmet with repositioning is recommended.'],
    ['Very severe', 'A helmet with repositioning is recommended.'],
  ];
  for (const [lvl, what] of usual) {
    text(lvl, M, y + 1, 9.5, 'bold', INK);
    y = text(what, M + 36, y + 1, 9.5, 'normal', INK, CW - 36) + 1.5;
  }
  y = text('Age matters: the head changes shape fastest in the first months, so earlier treatment usually works faster. Your clinician will talk through what suits your baby.', M, y + 1, 8.5, 'normal', MUTED) + 6;

  y = text('Why the head is measured again', M, y, 11.5, 'bold', INK) + 0.5;
  y = text('Repeat scans show how the head is growing and changing shape. Head size is checked first: when the head grows, there is room for the shape to improve. Each scan is measured at the same place on the head so the results can be compared fairly.', M, y, 10) + 6;

  text('If you have any questions about this report, please ask your clinician at your next visit.', M, y, 10, 'normal', MUTED);
  footer(2);

  doc.save(input.fileName);
}
