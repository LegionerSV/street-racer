import earcut from 'earcut';
import { footprintPrism, subtractPrisms, type Prism } from './geometry';
import { distance2, mixPoint } from './geo';
import type { Building, MeshData, Point } from './types';
type Colour = [number, number, number];

export function buildingCoveredByParts(building: Building, parts: Building[]) {
  if (!parts.length) return false;
  const triangles = (b: Building) => {
    const points = [...b.footprint],
      holes: number[] = [];
    for (const ring of b.holes || []) {
      holes.push(points.length);
      points.push(...ring);
    }
    const indices = earcut(
      points.flatMap((p) => [p.x, p.z]),
      holes,
    );
    return Array.from({ length: indices.length / 3 }, (_, i) =>
      indices.slice(i * 3, i * 3 + 3).map((j) => ({ ...points[j], y: 0 })),
    );
  };
  const area = (ring: Point[]) =>
    Math.abs(
      ring.reduce(
        (n, p, i) =>
          n +
          p.x * ring[(i + 1) % ring.length].z -
          ring[(i + 1) % ring.length].x * p.z,
        0,
      ) / 2,
    );
  const base = triangles(building),
    covers = parts.flatMap(triangles),
    total = base.reduce((n, t) => n + area(t), 0),
    tolerance = Math.max(0.001, total * 1e-7);
  if (covers.reduce((n, t) => n + area(t), 0) < total - tolerance) return false;
  const masks = covers.map((t) =>
    footprintPrism(t, { x: 0, y: 1, z: 0, w: 0 }, 1, 1),
  );
  return (
    base
      .flatMap((t) => subtractPrisms(t, masks))
      .reduce((n, t) => n + area(t), 0) <= tolerance
  );
}
const named: Record<string, string> = {
  white: '#e5e5dd',
  beige: '#c9bc9c',
  red: '#a75744',
  brown: '#806552',
  grey: '#969999',
  gray: '#969999',
  yellow: '#d2c087',
  green: '#8aab95',
  blue: '#88a5b6',
  black: '#494b4e',
};
export function facadeStyle(b: Building) {
  return b.material === 'brick'
    ? 0
    : ['glass', 'metal', 'steel'].includes(b.material || '') ||
        ['office', 'commercial', 'industrial'].includes(b.kind || '')
      ? 2
      : 1;
}
function colour(b: Building): Colour {
  let hex = named[b.facadeColour?.toLowerCase() || ''] || b.facadeColour || '';
  if (/^#[\da-f]{3}$/i.test(hex))
    hex =
      '#' +
      hex
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('');
  if (/^#[\da-f]{6}$/i.test(hex))
    return [1, 3, 5].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    ) as Colour;
  const palettes: Colour[][] = [
    [
      [0.62, 0.34, 0.26],
      [0.55, 0.41, 0.31],
      [0.66, 0.49, 0.34],
    ],
    [
      [0.69, 0.65, 0.52],
      [0.66, 0.71, 0.65],
      [0.73, 0.63, 0.48],
    ],
    [
      [0.56, 0.64, 0.68],
      [0.65, 0.68, 0.7],
      [0.46, 0.56, 0.6],
    ],
  ];
  return palettes[facadeStyle(b)][Math.min(2, Math.floor(b.colour * 3))];
}
function emitPolygon(
  mesh: MeshData,
  points: Point[],
  c: Colour,
  uv?: number[],
) {
  const base = mesh.positions.length / 3;
  for (const p of points) {
    mesh.positions.push(p.x, p.y, p.z);
    mesh.colors!.push(...c, 1);
  }
  if (uv) {
    mesh.uvs ??= [];
    mesh.uvs.push(...uv);
  }
  for (let i = 1; i < points.length - 1; i++)
    mesh.indices.push(base, base + i, base + i + 1);
}
function clip(points: Point[], plane: (p: Point) => number) {
  const output: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      da = plane(a),
      db = plane(b);
    if (da >= -1e-8) output.push(a);
    if (da >= 0 !== db >= 0) output.push(mixPoint(a, b, da / (da - db)));
  }
  return output;
}
export function appendBuilding(
  b: Building,
  lod: number,
  shell: MeshData,
  facades: MeshData[],
  openings: Prism[] = [],
  foundationFloor?: number,
) {
  const polygon = (
    mesh: MeshData,
    points: Point[],
    colour: Colour,
    uv?: number[],
  ) => {
    const vertices = points.map((p, i) => ({
      ...p,
      ...(uv ? { u: uv[i * 2], v: uv[i * 2 + 1] } : {}),
    }));
    for (const piece of subtractPrisms(vertices, openings))
      emitPolygon(
        mesh,
        piece,
        colour,
        uv ? piece.flatMap((p) => [p.u!, p.v!]) : undefined,
      );
  };
  const rings = [b.footprint, ...(b.holes || [])],
    flat = rings.flat(),
    holes: number[] = [];
  let count = b.footprint.length;
  for (const hole of rings.slice(1)) {
    holes.push(count);
    count += hole.length;
  }
  const indices = earcut(
      flat.flatMap((p) => [p.x, p.z]),
      holes,
    ),
    floor =
      (foundationFloor ?? Math.min(...flat.map((p) => p.y))) +
      (b.minHeight || 0) -
      0.3;
  const top = Math.max(...flat.map((p) => p.y)) + b.height,
    c = colour(b),
    roofColour: Colour = c.map((v) => v * 0.48) as Colour;
  const pitched =
    lod === 0 && ['gabled', 'hipped', 'pyramidal', 'skillion'].includes(b.roof);
  const rise = pitched
      ? Math.min(
          b.roofHeight ?? Math.min(4, b.height * 0.2),
          Math.max(0, (top - floor) * 0.45),
        )
      : 0,
    eaves = top - rise;
  const longest = b.footprint.reduce(
    (best, p, i) =>
      distance2(p, b.footprint[(i + 1) % b.footprint.length]) >
      distance2(b.footprint[best], b.footprint[(best + 1) % b.footprint.length])
        ? i
        : best,
    0,
  );
  const a = b.footprint[longest],
    end = b.footprint[(longest + 1) % b.footprint.length],
    l = distance2(a, end) || 1;
  let ux = (end.z - a.z) / l,
    uz = -(end.x - a.x) / l;
  if (b.roofOrientation === 'across') [ux, uz] = [-uz, ux];
  if (b.roofDirection !== undefined) {
    ux = Math.sin((b.roofDirection * Math.PI) / 180);
    uz = Math.cos((b.roofDirection * Math.PI) / 180);
  }
  const u = (p: Point) => p.x * ux + p.z * uz,
    v = (p: Point) => -p.x * uz + p.z * ux;
  const us = flat.map(u),
    vs = flat.map(v),
    u0 = Math.min(...us),
    u1 = Math.max(...us),
    v0 = Math.min(...vs),
    v1 = Math.max(...vs);
  const hu = Math.max(0.01, (u1 - u0) / 2),
    hv =
      b.roof === 'hipped'
        ? Math.min(hu, (v1 - v0) / 2)
        : Math.max(0.01, (v1 - v0) / 2);
  const planes: ((p: Point) => number)[] = !rise
    ? [() => top]
    : b.roof === 'skillion'
      ? [(p) => eaves + (rise * (u(p) - u0)) / (u1 - u0 || 1)]
      : [
          (p) => eaves + (rise * (u(p) - u0)) / hu,
          (p) => eaves + (rise * (u1 - u(p))) / hu,
        ];
  if (rise && ['hipped', 'pyramidal'].includes(b.roof))
    planes.push(
      (p) => eaves + (rise * (v(p) - v0)) / hv,
      (p) => eaves + (rise * (v1 - v(p))) / hv,
    );
  const roofY = (p: Point) => Math.min(...planes.map((plane) => plane(p)));
  const facade = lod === 0 ? facades[facadeStyle(b)] : shell,
    floorHeight = Math.max(
      2.5,
      (eaves - floor) /
        Math.max(1, b.levels ?? Math.round((eaves - floor) / 3.2)),
    );
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        length = distance2(a, b),
        cuts = [0, 1];
      for (let j = 0; j < planes.length; j++)
        for (let k = j + 1; k < planes.length; k++) {
          const da = planes[j](a) - planes[k](a),
            db = planes[j](b) - planes[k](b);
          if (da * db < 0) cuts.push(da / (da - db));
        }
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const start = mixPoint(a, b, cuts[j - 1]),
          end = mixPoint(a, b, cuts[j]),
          ya = roofY(start),
          yb = roofY(end);
        polygon(
          facade,
          [
            { ...start, y: floor },
            { ...end, y: floor },
            { ...end, y: yb },
            { ...start, y: ya },
          ],
          c,
          lod === 0
            ? [
                (cuts[j - 1] * length) / 3.6,
                0,
                (cuts[j] * length) / 3.6,
                0,
                (cuts[j] * length) / 3.6,
                (yb - floor) / floorHeight,
                (cuts[j - 1] * length) / 3.6,
                (ya - floor) / floorHeight,
              ]
            : undefined,
        );
      }
      if (lod === 0) {
        const area = ring.reduce(
            (sum, p, j) =>
              sum +
              p.x * ring[(j + 1) % ring.length].z -
              ring[(j + 1) % ring.length].x * p.z,
            0,
          ),
          sign = (area > 0 ? 1 : -1) * (ring === rings[0] ? 1 : -1);
        const offset = (p: Point, y: number) => ({
          x: p.x + ((b.z - a.z) / (length || 1)) * 0.14 * sign,
          y,
          z: p.z - ((b.x - a.x) / (length || 1)) * 0.14 * sign,
        });
        for (const [low, high, tint] of [
          [floor, floor + 0.55, 0.65],
          [eaves - 0.2, eaves, 1.12],
        ]) {
          const band = c.map((v) => Math.min(0.9, v * tint)) as Colour;
          polygon(
            shell,
            [offset(a, low), offset(b, low), offset(b, high), offset(a, high)],
            band,
          );
          polygon(
            shell,
            [
              { ...a, y: high },
              offset(a, high),
              offset(b, high),
              { ...b, y: high },
            ],
            band,
          );
        }
      }
    }
  // Каждая треугольная часть контура режется плоскостями скатов; дворы остаются пустыми.
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3).map((j) => flat[j]);
    for (let j = 0; j < planes.length; j++) {
      let part = triangle;
      for (let k = 0; k < planes.length; k++)
        if (k !== j) part = clip(part, (p) => planes[k](p) - planes[j](p));
      if (part.length >= 3)
        polygon(
          shell,
          part.map((p) => ({ ...p, y: planes[j](p) })),
          roofColour,
        );
    }
    if ((b.minHeight || 0) > 0)
      polygon(
        shell,
        [...triangle].reverse().map((p) => ({ ...p, y: floor })),
        roofColour,
      );
  }
}
