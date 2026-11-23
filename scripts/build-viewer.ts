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
// Brand assets: Mulish (SIL Open Font License) and the Printed Symmetry logo.
const asset = (f: string) => readFileSync(join(root, 'viewer/assets', f)).toString('base64');
const face = (w: number, style: string, f: string) =>
  `@font-face{font-family:Mulish;font-weight:${w};font-style:${style};src:url(data:font/woff2;base64,${asset(f)}) format('woff2')}`;
const fonts = [
  face(400, 'normal', 'mulish-latin-400-normal.woff2'), face(600, 'normal', 'mulish-latin-600-normal.woff2'),
  face(700, 'normal', 'mulish-latin-700-normal.woff2'), face(400, 'italic', 'mulish-latin-400-italic.woff2'),
].join('\n');
const logo = `data:image/png;base64,${asset('ps-logo-horizontal.png')}`;
const brand = JSON.stringify({
  logo,
  fonts: { regular: asset('Mulish-400-normal.ttf'), bold: asset('Mulish-700-normal.ttf'), italic: asset('Mulish-400-italic.ttf') },
});
const html = readFileSync(join(root, 'viewer/index.html'), 'utf8')
  .replace('/*FONTS*/', () => fonts)
  .replace('/*LOGO*/', () => logo)
  .replace('/*BRAND*/null', () => brand)
  .replace('/*CASE*/null', () => caseJson)
  .replace('/*APP*/', () => js);
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${(html.length / 1e6).toFixed(2)} MB)`);
