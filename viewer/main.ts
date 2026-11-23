/**
 * Head shape review: the first scan with its proposed helmet, the clearance
 * heatmap, follow-up scans lined up and measured at the same level, the 2D
 * shape at the measurement level, and a plain-language PDF for the family.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { findEarTops, measureHead, parseStl, type Landmarks, type Measurements, type Mesh } from '../src/measure/index.js';
import { measureFollowUp } from '../src/measure/followup.js';
import type { Similarity } from '../src/align/register.js';
import type { Vec2, Vec3 } from '../src/measure/vec.js';
import { shapeSvg, type OutlineLayer } from './shape.js';
import { familyReport, type FamilyReportInput } from './family-report.js';

interface Part { pos: string; idx: string }
interface CaseData {
  caseId: string;
  baselineDate: string;
  /** Clearance to the helmet per vertex, 0.01 mm (only with a helmet). */
  head: Part & { clr?: string };
  helmet?: Part;
  landmarks: Landmarks;
  stats?: { shares: { label: string; lo: number; hi: number; pct: number }[]; coveredAreaCm2: number; median: number; p95: number };
  alignNote?: string;
}
interface Scan {
  id: number;
  label: string;
  date: string; // yyyy-mm-dd
  mesh: Mesh;
  landmarks: Landmarks;
  m: Measurements;
  transform?: Similarity;
  colour: string;
  object: THREE.Mesh;
  visible: boolean;
}

const CASE = (window as unknown as { CASE: CaseData }).CASE;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const f1 = (v: number) => v.toFixed(1);
// Printed Symmetry palette (style guide V2).
const SCAN_COLOURS = ['#836851', '#475d63', '#473528', '#6c7a89'];
const HELMET_COLOUR = '#475463';
const FIRST_COLOUR = '#838484';

// ---------- decoding ----------
function decode<T extends Int16Array | Uint16Array>(b64: string, Type: { new (b: ArrayBuffer): T }): T {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Type(u.buffer);
}
function positions(part: Part): Float32Array {
  const p = decode(part.pos, Int16Array), out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i]! / 100;
  return out;
}
function toEngineMesh(pos: Float32Array, idx: Uint16Array | Uint32Array): Mesh {
  const tri = new Float64Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) for (let k = 0; k < 3; k++) tri[i * 3 + k] = pos[idx[i]! * 3 + k]!;
  return { triangles: tri, triangleCount: idx.length / 3 };
}

// ---------- clearance colours ----------
const STOPS: [number, number[]][] = [[-3, [178, 24, 43]], [-1, [230, 110, 80]], [0, [246, 213, 92]], [1, [214, 222, 110]], [3, [127, 191, 123]], [6, [63, 159, 181]], [10, [44, 79, 143]]];
const NEUTRAL = [216, 210, 192];
function colour(v: number): number[] {
  if (v <= STOPS[0]![0]) return STOPS[0]![1];
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i]!, [a, ca] = STOPS[i - 1]!;
    if (v <= b) { const t = (v - a) / (b - a); return ca.map((c, k) => c + t * (cb[k]! - c)); }
  }
  return STOPS.at(-1)![1];
}

// ---------- 3D scene ----------
const host = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xf3f2ed);
host.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(key);

function geometry(pos: Float32Array, idx: Uint16Array) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

const headPos = positions(CASE.head), headIdx = decode(CASE.head.idx, Uint16Array);
const headGeo = geometry(headPos, headIdx);
const clr = CASE.head.clr ? decode(CASE.head.clr, Int16Array) : new Int16Array(headPos.length / 3).fill(-32768);
const heat = new Float32Array(clr.length * 3), plain = new Float32Array(clr.length * 3);
for (let i = 0; i < clr.length; i++) {
  const c = clr[i] === -32768 ? NEUTRAL : colour(clr[i]! / 100);
  for (let k = 0; k < 3; k++) { heat[i * 3 + k] = (c[k]! / 255) ** 2.2; plain[i * 3 + k] = (NEUTRAL[k]! / 255) ** 2.2; }
}
const colourAttr = new THREE.BufferAttribute(heat.slice(), 3);
headGeo.setAttribute('color', colourAttr);
const headObj = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
scene.add(headObj);

let helmetObj: THREE.Mesh | null = null, helmetEdges: THREE.LineSegments | null = null, helmetM: Measurements | null = null;
const helmetMat = new THREE.MeshStandardMaterial({
  color: 0x6c7a89, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
});
let helmetMesh: Mesh | null = null;
if (CASE.helmet) {
  const hp = positions(CASE.helmet), hi = decode(CASE.helmet.idx, Uint16Array);
  helmetMesh = toEngineMesh(hp, hi);
  helmetObj = new THREE.Mesh(geometry(hp, hi), helmetMat);
  helmetObj.renderOrder = 2;
  scene.add(helmetObj);
  // Trimlines: edges used by one triangle only.
  const seen = new Map<number, number>();
  for (let t = 0; t < hi.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = hi[t + e]!, b = hi[t + ((e + 1) % 3)]!, k = a < b ? a * 65536 + b : b * 65536 + a;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const pts: number[] = [];
  for (const [k, n] of seen) if (n === 1) for (const v of [Math.floor(k / 65536), k % 65536]) pts.push(hp[v * 3]!, hp[v * 3 + 1]!, hp[v * 3 + 2]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  helmetEdges = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x475463 }));
  helmetEdges.renderOrder = 3;
  scene.add(helmetEdges);
}

// ---------- measurements of the first scan and the helmet ----------
const baseMesh = toEngineMesh(headPos, headIdx);
// Ear tops are proposed from the scan shape when the case does not include them.
const LM: Landmarks = CASE.landmarks.earTopLeft && CASE.landmarks.earTopRight
  ? CASE.landmarks : { ...CASE.landmarks, ...findEarTops(baseMesh, CASE.landmarks) };
const baseM = measureHead(baseMesh, LM);
if (helmetMesh) helmetM = measureHead(helmetMesh, LM, { planeHeight: baseM.planeHeight });

const scans: Scan[] = [{
  id: 0, label: 'First scan', date: CASE.baselineDate, mesh: baseMesh, landmarks: LM, m: baseM,
  colour: FIRST_COLOUR, object: headObj, visible: true,
}];
let nextId = 1;

// View axes: the scanner's vertical (scanned upright), and front levelled from the landmarks.
const U = new THREE.Vector3(0, 0, 1);
const F = new THREE.Vector3(...baseM.frame.forward).projectOnPlane(U).normalize();
const L = new THREE.Vector3().crossVectors(U, F).normalize();
camera.up.copy(U);
const box = new THREE.Box3().setFromObject(helmetObj ?? headObj);
const centre = box.getCenter(new THREE.Vector3());
const radius = box.getSize(new THREE.Vector3()).length() / 2;
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(centre);
controls.enableDamping = true;
const VIEWS: Record<string, THREE.Vector3> = {
  front: F, back: F.clone().negate(), left: L, right: L.clone().negate(),
  top: U.clone().addScaledVector(F, -0.002).normalize(),
};
function setView(name: string) {
  const dist = (radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
  camera.position.copy(centre).addScaledVector(VIEWS[name]!, dist);
  camera.lookAt(centre);
  controls.target.copy(centre);
  controls.update();
  document.querySelectorAll<HTMLButtonElement>('#views button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
}
document.querySelectorAll<HTMLButtonElement>('#views button').forEach((b) => (b.onclick = () => setView(b.dataset.v!)));

// Outlines and landmarks in 3D. Follow-ups are turned and moved onto the first scan
// but kept at their true size, grown about the first scan's ear midpoint.
const outlineGroup = new THREE.Group();
const marks = new THREE.Group();
scene.add(outlineGroup, marks);
function frameToWorld(m: Measurements, p: Vec2): THREE.Vector3 {
  const { origin: o, left: l, forward: f, up: u } = m.frame;
  return new THREE.Vector3(...[0, 1, 2].map((i) => o[i]! + p[0] * l[i]! + p[1] * f[i]! + m.planeHeight * u[i]!) as [number, number, number]);
}
function rebuildOutlines3d() {
  outlineGroup.clear();
  const add = (m: Measurements, c: string, matrix?: THREE.Matrix4) => {
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(m.outline.map((p) => frameToWorld(m, p))),
      new THREE.LineBasicMaterial({ color: c, depthTest: false }));
    if (matrix) line.applyMatrix4(matrix);
    line.renderOrder = 5;
    outlineGroup.add(line);
  };
  for (const s of scans) if (s.visible) add(s.m, s.colour, s.transform ? placeMatrix(s.transform) : undefined);
  if (helmetM && helmetObj?.visible) add(helmetM, HELMET_COLOUR);
  marks.clear();
  for (const p of Object.values(LM)) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x473528, depthTest: false }));
    s.position.set(...(p as [number, number, number]));
    s.renderOrder = 6;
    marks.add(s);
  }
}
/** Places a follow-up onto the first scan without undoing its growth. */
function placeMatrix(t: Similarity) {
  const o = baseM.frame.origin, k = 1 / t.scale;
  return new THREE.Matrix4().makeTranslation(o[0], o[1], o[2])
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2]))
    .multiply(similarityMatrix(t));
}
function similarityMatrix(t: Similarity) {
  const r = t.rotation, s = t.scale;
  return new THREE.Matrix4().set(
    s * r[0]!, s * r[1]!, s * r[2]!, t.translation[0],
    s * r[3]!, s * r[4]!, s * r[5]!, t.translation[1],
    s * r[6]!, s * r[7]!, s * r[8]!, t.translation[2],
    0, 0, 0, 1,
  );
}

// ---------- panels ----------
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const sorted = () => [...scans].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

function renderScans() {
  const host = $('scans');
  host.innerHTML = '';
  for (const s of sorted()) {
    const row = document.createElement('div');
    row.className = 'scan';
    row.innerHTML = `<span class="dot" style="background:${s.colour}"></span>
      <label class="name"><input type="checkbox" ${s.visible ? 'checked' : ''}> ${s.label}
      <small>${s.transform ? `lined up to the first scan, size ×${(1 / s.transform.scale).toFixed(3)}` : 'reference for later scans'}</small></label>
      <input type="date" value="${s.date}">${s.id ? '<button title="Remove this scan">Remove</button>' : ''}`;
    const [chk, date] = row.querySelectorAll('input') as unknown as [HTMLInputElement, HTMLInputElement];
    chk.onchange = () => { s.visible = chk.checked; s.object.visible = s.visible; refresh(); };
    date.onchange = () => { if (date.value) { s.date = date.value; refresh(); } };
    row.querySelector('button')?.addEventListener('click', () => {
      scene.remove(s.object);
      scans.splice(scans.indexOf(s), 1);
      refresh();
    });
    host.appendChild(row);
  }
  const list = sorted(), first = list[0]!, last = list.at(-1)!;
  $('summary').innerHTML = list.length > 1
    ? `<div class="summary"><b>Since ${fmtDate(first.date)}:</b> circumference ${last.m.headCircumferenceMm >= first.m.headCircumferenceMm ? '+' : ''}${f1(last.m.headCircumferenceMm - first.m.headCircumferenceMm)} mm,
       CVAI ${f1(first.m.cvai)}% → ${f1(last.m.cvai)}%, CR ${f1(first.m.cr)}% → ${f1(last.m.cr)}%.</div>`
    : '';
}

function shapeLayers(forPdf = false): { layers: OutlineLayer[]; key: { label: string; colour: string; dashed?: boolean }[] } {
  const list = sorted().filter((s) => s.visible || forPdf);
  const last = list.at(-1);
  const layers: OutlineLayer[] = [];
  const key: { label: string; colour: string; dashed?: boolean }[] = [];
  if (helmetM && !forPdf && helmetObj?.visible) {
    layers.push({ points: helmetM.outline, colour: HELMET_COLOUR, fill: 'rgba(108,122,137,0.14)' });
    key.push({ label: 'Helmet inner surface', colour: HELMET_COLOUR });
  }
  for (const s of list) {
    const isLast = s === last;
    layers.push({ points: s.m.outline, colour: s.colour, dashed: !isLast, width: isLast ? 2 : 1.4, diagonals: isLast });
    key.push({ label: `${s.label}, ${fmtDate(s.date)}`, colour: s.colour, dashed: !isLast });
  }
  return { layers, key };
}

function renderShape() {
  const { layers, key } = shapeLayers();
  $('shape').innerHTML = layers.length ? shapeSvg(layers) : '<p class="note">Turn on a scan to see its shape.</p>';
  $('shapeKey').innerHTML = key.map((k) => `<span><i style="border-color:${k.colour};${k.dashed ? 'border-top-style:dashed' : ''}"></i>${k.label}</span>`).join('');
}

function renderMeasurements() {
  const list = sorted();
  const cols: { title: string; m: Measurements }[] = list.map((s) => ({ title: fmtDate(s.date), m: s.m }));
  if (helmetM) cols.push({ title: 'Helmet', m: helmetM });
  const row = (label: string, fn: (m: Measurements, i: number) => string) =>
    `<tr><td>${label}</td>${cols.map((c, i) => `<td>${fn(c.m, i)}</td>`).join('')}</tr>`;
  const isHelmet = (i: number) => !!helmetM && i === cols.length - 1;
  $('meas').innerHTML = `<tr><th></th>${cols.map((c) => `<th>${c.title}</th>`).join('')}</tr>` +
    row('Circumference (mm)', (m) => f1(m.headCircumferenceMm)) +
    row('CVAI (%)', (m) => `${f1(m.cvai)}<span class="lvl">${m.cvaiGrade.level}</span>`) +
    row('CR (%)', (m) => `${f1(m.cr)}<span class="lvl">${m.crGrade.level}</span>`) +
    row('CVA (mm)', (m) => f1(m.cvaMm)) +
    row('Length (mm)', (m) => f1(m.lengthMm)) +
    row('Width (mm)', (m) => f1(m.widthMm)) +
    row('Diagonal, front-left (mm)', (m) => f1(m.diagonalFrontLeftMm)) +
    row('Diagonal, front-right (mm)', (m) => f1(m.diagonalFrontRightMm)) +
    row('Ear shift (mm)', (m, i) => (isHelmet(i) ? '–' : `${f1(Math.abs(m.earShiftMm))}<span class="lvl">${m.earForward} forward</span>`)) +
    row('Level (mm)', (m) => f1(m.planeHeight));
  $('measNote').textContent = `Measured at the level of largest circumference on the first scan, ${f1(baseM.planeHeight)} mm above the plane through sellion and the ear tops (levelled side to side). ` +
    'Follow-up scans are measured at the same place on the head, scaled with growth.' + (helmetM ? ' The helmet is cut at the first scan’s level.' : '');
}

function renderClearance() {
  if (!CASE.stats) return;
  $('bar').style.background = 'linear-gradient(90deg,' + STOPS.map(([v, c]) => `rgb(${c.map(Math.round).join(',')}) ${(((v + 3) / 13) * 100).toFixed(1)}%`).join(',') + ')';
  const short = ['Pressure, over 1 mm', 'Contact, within 1 mm', 'Gap 1 to 3 mm', 'Gap 3 to 5 mm', 'Gap 5 to 8 mm', 'Gap over 8 mm'];
  $('bands').innerHTML = CASE.stats.shares.map((b, i) => {
    const mid = b.lo < -50 ? -2 : b.hi > 50 ? 9 : (b.lo + b.hi) / 2;
    return `<tr><td><span class="sw" style="background:rgb(${colour(mid).map(Math.round).join(',')})"></span>${short[i] ?? b.label}</td><td>${b.pct.toFixed(1)}%</td></tr>`;
  }).join('');
  $('clearNote').textContent = `Share of the first scan's surface under the helmet (${CASE.stats.coveredAreaCm2} cm²). Median gap ${CASE.stats.median} mm.`;
  $('alignNote').textContent = CASE.alignNote ?? '';
}

function applyDisplay() {
  const helmetOn = $<HTMLInputElement>('tHelmet').checked;
  if (helmetObj) helmetObj.visible = helmetOn;
  if (helmetEdges) helmetEdges.visible = helmetOn;
  colourAttr.array.set($<HTMLInputElement>('tHeat').checked ? heat : plain);
  colourAttr.needsUpdate = true;
  outlineGroup.visible = $<HTMLInputElement>('tOutline').checked;
  marks.visible = $<HTMLInputElement>('tLm').checked;
  const o = Number($<HTMLInputElement>('op').value) / 100;
  helmetMat.opacity = Math.max(o, 0.02);
  helmetMat.transparent = o <= 0.95;
  helmetMat.depthWrite = o > 0.95;
  helmetMat.needsUpdate = true;
}

function refresh() {
  renderScans();
  renderShape();
  renderMeasurements();
  rebuildOutlines3d();
  applyDisplay();
}
['tHelmet', 'tHeat', 'tOutline', 'tLm'].forEach((id) => ($(id).onchange = () => { applyDisplay(); renderShape(); rebuildOutlines3d(); applyDisplay(); }));
$('op').oninput = applyDisplay;
if (!CASE.helmet) {
  // Assessment before any helmet is made: hide the helmet and clearance controls.
  $<HTMLInputElement>('tHelmet').checked = false;
  $<HTMLInputElement>('tHeat').checked = false;
  document.querySelectorAll<HTMLElement>('.helmet-only').forEach((e) => (e.hidden = true));
}

// ---------- follow-up scans ----------
const busy = (on: boolean, msg = '') => { $('busy').classList.toggle('on', on); $('busyText').textContent = msg; };
$('addScan').onclick = () => $<HTMLInputElement>('file').click();
$<HTMLInputElement>('file').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy(true, 'Lining up the scan with the first one… this takes about 10 seconds');
  await new Promise((r) => setTimeout(r, 50));
  try {
    const mesh = parseStl(new Uint8Array(await file.arrayBuffer()));
    const result = measureFollowUp({ mesh: baseMesh, landmarks: LM, measurements: baseM }, mesh);
    const colour = SCAN_COLOURS[(scans.length - 1) % SCAN_COLOURS.length]!;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.triangles), 3));
    g.computeVertexNormals();
    const obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }));
    obj.applyMatrix4(placeMatrix(result.transform));
    obj.renderOrder = 1;
    scene.add(obj);
    const n = scans.length;
    scans.push({
      id: nextId++, label: `Follow-up ${n}`, date: new Date().toISOString().slice(0, 10), mesh, landmarks: result.landmarks,
      m: result.measurements, transform: result.transform, colour, object: obj, visible: true,
    });
    if (result.medianResidualMm > 2) alert('This scan did not line up closely with the first one. Check that it is the same infant and a complete head scan.');
    refresh();
  } catch (err) {
    alert(`This scan could not be measured: ${(err as Error).message}`);
  } finally {
    busy(false);
  }
};

// ---------- family PDF ----------
async function svgToPng(svg: string, w = 880, h = 800): Promise<string> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.9);
}
function viewPng(): string {
  // Square capture of the current 3D view.
  const src = renderer.domElement, s = Math.min(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = 880; c.height = 800;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f3f2ed';
  ctx.fillRect(0, 0, c.width, c.height);
  // The family report shows the head scans only: no helmet, clearance colours or markers.
  if (helmetObj) helmetObj.visible = false;
  if (helmetEdges) helmetEdges.visible = false;
  colourAttr.array.set(plain);
  colourAttr.needsUpdate = true;
  outlineGroup.visible = false;
  marks.visible = false;
  renderer.render(scene, camera);
  ctx.drawImage(src, (src.width - s) / 2, (src.height - s * (800 / 880)) / 2, s, s * (800 / 880), 0, 0, 880, 800);
  applyDisplay();
  return c.toDataURL('image/jpeg', 0.9);
}
$('familyPdf').onclick = () => ($<HTMLDialogElement>('dlg')).showModal();
$<HTMLFormElement>('dlgForm').onsubmit = async (e) => {
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value !== 'ok') return;
  const { layers, key } = shapeLayers(true);
  const shapePng = await svgToPng(shapeSvg(layers));
  const list = sorted();
  const name = $<HTMLInputElement>('fName').value.trim();
  familyReport({
    childName: name,
    clinician: $<HTMLInputElement>('fClin').value,
    clinic: $<HTMLInputElement>('fClinic').value,
    preparedOn: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
    scans: list.map((s) => ({ date: fmtDate(s.date), cvai: s.m.cvai, cvaiLevel: s.m.cvaiGrade.level, cr: s.m.cr, crLevel: s.m.crGrade.level, circumferenceMm: s.m.headCircumferenceMm })),
    shapePng,
    shapeKey: key,
    viewPng: viewPng(),
    brand: (window as unknown as { BRAND?: FamilyReportInput['brand'] }).BRAND ?? null,
    fileName: `Head shape report${name ? ` - ${name}` : ''} - ${new Date().toISOString().slice(0, 10)}.pdf`,
  });
};

// ---------- start ----------
$('meta').textContent = `Case ${CASE.caseId} · first scan ${fmtDate(CASE.baselineDate)}`;
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();
setView('top');
renderClearance();
refresh();
(function tick() {
  key.position.copy(camera.position);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
})();

// Hooks for automated checks and report image capture.
(window as unknown as { viewer: unknown }).viewer = {
  ready: true,
  scans: () => sorted().map((s) => ({ label: s.label, date: s.date, cvai: s.m.cvai, cr: s.m.cr, hc: s.m.headCircumferenceMm, plane: s.m.planeHeight, scale: s.transform?.scale })),
  setView,
};
export type { Vec3 };
