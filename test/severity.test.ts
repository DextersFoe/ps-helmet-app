import { describe, expect, it } from 'vitest';
import { gradeCr, gradeCvai } from '../src/measure/severity.js';

describe('CVAI levels (clinician reference, page 3)', () => {
  it.each([
    [0, 'Normal'],
    [3.5, 'Normal'],
    [3.51, 'Mild'],
    [6.25, 'Mild'],
    [7, 'Moderate'],
    [8.75, 'Moderate'],
    [10, 'Severe'],
    [11, 'Severe'],
    [11.01, 'Very severe'],
  ])('CVAI %d%% is %s', (cvai, level) => {
    expect(gradeCvai(cvai).level).toBe(level);
  });
});

describe('CR levels (clinician reference, page 3, plus clinic rules under 82%)', () => {
  it.each([
    [70, 'Scaphocephaly'],
    [74.9, 'Scaphocephaly'],
    [75, 'Normal'],
    [80, 'Normal'],
    [90, 'Normal'],
    [92, 'Mild'],
    [95, 'Mild'],
    [97, 'Moderate'],
    [100, 'Moderate'],
    [103, 'Severe'],
    [105, 'Severe'],
    [106, 'Very severe'],
  ])('CR %d%% is %s', (cr, level) => {
    expect(gradeCr(cr).level).toBe(level);
  });

  it('gives the reference recommendation for each level', () => {
    expect(gradeCr(98).recommendation).toMatch(/Orthosis typically recommended/);
    expect(gradeCvai(12).recommendation).toMatch(/Orthosis plus repositioning/);
  });
});
