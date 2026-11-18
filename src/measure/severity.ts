/**
 * Severity levels from the Printed Symmetry clinician reference
 * (Cranial Remodelling Assessment & 3D Scanning, page 3), with the clinic's
 * confirmed additions: CR 75 to 82% is normal, under 75% is scaphocephaly.
 *
 * Band edges: a value exactly on an edge goes to the milder level
 * (for example CVAI 3.5 is Normal). This edge rule needs clinical confirmation.
 */

export type Level = 'Normal' | 'Mild' | 'Moderate' | 'Severe' | 'Very severe';
export type CrLevel = Level | 'Scaphocephaly';

export interface Graded<L extends string> {
  level: L;
  recommendation: string;
}

const REPOSITION_OR_REQUEST =
  'Repositioning program. Reassess after 1 month if under 5 months of age. Orthosis at parents’ request.';

export function gradeCvai(cvai: number): Graded<Level> {
  if (cvai <= 3.5) return { level: 'Normal', recommendation: 'No treatment.' };
  if (cvai <= 6.25) return { level: 'Mild', recommendation: REPOSITION_OR_REQUEST };
  if (cvai <= 8.75) return { level: 'Moderate', recommendation: REPOSITION_OR_REQUEST };
  if (cvai <= 11) return { level: 'Severe', recommendation: 'Repositioning. Orthosis at parents’ request.' };
  return { level: 'Very severe', recommendation: 'Orthosis plus repositioning.' };
}

export function gradeCr(cr: number): Graded<CrLevel> {
  if (cr < 75) return { level: 'Scaphocephaly', recommendation: 'Report for clinical review.' };
  if (cr <= 90) return { level: 'Normal', recommendation: 'No treatment.' };
  if (cr <= 95) return { level: 'Mild', recommendation: REPOSITION_OR_REQUEST };
  if (cr <= 100) {
    return {
      level: 'Moderate',
      recommendation: 'Repositioning. Orthosis typically recommended (consider age and history).',
    };
  }
  if (cr <= 105) return { level: 'Severe', recommendation: 'Orthosis plus repositioning.' };
  return { level: 'Very severe', recommendation: 'Orthosis plus repositioning.' };
}
