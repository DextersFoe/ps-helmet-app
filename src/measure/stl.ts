/**
 * STL loading. A mesh is kept as a flat triangle list: 9 numbers per triangle
 * (three vertices, x y z each), in the file's units (expected: millimetres).
 */

export interface Mesh {
  /** x0 y0 z0 x1 y1 z1 x2 y2 z2 for each triangle. */
  readonly triangles: Float64Array;
  readonly triangleCount: number;
}

export function parseStl(data: ArrayBuffer | Uint8Array): Mesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (isBinaryStl(bytes)) return parseBinary(bytes);
  return parseAscii(new TextDecoder().decode(bytes));
}

function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  // The size check is reliable; some binary files also start with "solid".
  return 84 + count * 50 === bytes.length;
}

function parseBinary(bytes: Uint8Array): Mesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const triangles = new Float64Array(count * 9);
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12; // skip the stored normal
    for (let k = 0; k < 9; k++) triangles[t * 9 + k] = view.getFloat32(base + k * 4, true);
  }
  return { triangles, triangleCount: count };
}

function parseAscii(text: string): Mesh {
  if (!/^\s*solid/i.test(text)) throw new Error('Not an STL file');
  const values: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (values.length === 0 || values.length % 9 !== 0 || values.some((v) => !Number.isFinite(v))) {
    throw new Error('Malformed ASCII STL: vertex data is incomplete');
  }
  return { triangles: Float64Array.from(values), triangleCount: values.length / 9 };
}

/** Axis-aligned bounds, used for the units sanity check. */
export function bounds(mesh: Mesh): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const t = mesh.triangles;
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = t[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}
