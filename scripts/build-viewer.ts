/**
 * Builds the single-file case viewer: bundles viewer/main.ts and inlines it,
 * with one case's data, into viewer/index.html.
 *
 *   npx tsx scripts/build-viewer.ts <case.json> <out.html>
 *
 * The case file holds patient-derived data. Keep it and the output out of the repo.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [casePath, outPath] = process.argv.slice(2);
if (!casePath || !outPath) {
  console.error('Usage: tsx scripts/build-viewer.ts <case.json> <out.html>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [join(root, 'viewer/main.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  // Optional jsPDF features (HTML rendering) that the report does not use.
  external: ['html2canvas', 'dompurify', 'canvg'],
  logLevel: 'warning',
});
const js = result.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script');
const caseJson = readFileSync(casePath, 'utf8').trim().replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(root, 'viewer/index.html'), 'utf8')
  .replace('/*CASE*/null', () => caseJson)
  .replace('/*APP*/', () => js);
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${(html.length / 1e6).toFixed(2)} MB)`);
