import { distance2 } from './geo';
import type { Building, Point } from './types';

export function osmLength(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(m|ft|')?\s*$/i.exec(value);
  if (!match) return undefined;
  const n =
    Number(match[1]) *
    (match[2] && match[2].toLowerCase() !== 'm' ? 0.3048 : 1);
  return Number.isFinite(n) ? n : undefined;
}
export function osmDirection(value?: string): number | undefined {
  const compass = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const i = compass.indexOf(value?.trim().toUpperCase() || '');
  if (i >= 0) return i * 22.5;
  const n =
    value?.trim() && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : undefined;
  return n !== undefined && n <= 360 ? n % 360 : undefined;
}

export const roofAliases: Record<string, string> = {
  barrel: 'round',
  side_hipped: 'hipped',
};
export const roofShapes = [
  'flat',
  'gabled',
  'hipped',
  'pyramidal',
  'skillion',
  'mansard',
  'gambrel',
  'saltbox',
  'half-hipped',
  'round',
  'dome',
  'onion',
  'cone',
];
export function roofForm(b: Building, lod: number, top: number, floor: number) {
  const source = b.roof.trim().toLowerCase();
  let shape = roofAliases[source] || source;
  if (!roofShapes.includes(shape)) shape = 'flat';
  const ring = b.footprint;
  const longest = ring.reduce(
    (best, p, i) =>
      distance2(p, ring[(i + 1) % ring.length]) >
      distance2(ring[best], ring[(best + 1) % ring.length])
        ? i
        : best,
    0,
  );
  const a = ring[longest],
    end = ring[(longest + 1) % ring.length],
    length = distance2(a, end) || 1;
  let ux = (end.z - a.z) / length,
    uz = -(end.x - a.x) / length;
  if (b.roofOrientation === 'across') [ux, uz] = [-uz, ux];
  if (b.roofDirection !== undefined) {
    ux = Math.sin((b.roofDirection * Math.PI) / 180);
    uz = Math.cos((b.roofDirection * Math.PI) / 180);
  }
  const u = (p: Point) => p.x * ux + p.z * uz,
    v = (p: Point) => -p.x * uz + p.z * ux;
  const us = ring.map(u),
    vs = ring.map(v),
    u0 = Math.min(...us),
    u1 = Math.max(...us),
    v0 = Math.min(...vs),
    v1 = Math.max(...vs);
  const width = Math.max(0.01, u1 - u0),
    depth = Math.max(0.01, v1 - v0);
  const radial = ['dome', 'onion', 'cone'].includes(shape);
  // Радиальные профили требуют выпуклого одиночного контура. Иначе плоская
  // крыша сохраняет двор/вогнутость, не придумывая купол над пустотой.
  const crosses = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length],
      r = ring[(i + 2) % ring.length];
    return (q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x);
  });
  if (
    radial &&
    (b.holes?.length ||
      ring.length > 64 ||
      (crosses.some((c) => c > 1e-5) && crosses.some((c) => c < -1e-5)))
  )
    shape = 'flat';
  const angle =
    b.roofAngle !== undefined && b.roofAngle > 0 && b.roofAngle < 85
      ? b.roofAngle
      : undefined;
  const run = shape === 'skillion' ? width : width / 2;
  const rise =
    shape === 'flat'
      ? 0
      : Math.min(
          Math.max(0, top - floor),
          b.roofHeight ??
            (angle !== undefined
              ? Math.tan((angle * Math.PI) / 180) * run
              : b.roofLevels && b.roofLevels > 0
                ? b.roofLevels * 3
                : radial
                  ? Math.min(width, depth) / 2
                  : Math.min(4, b.height * 0.2)),
        );
  const eaves = top - rise;
  let profile: [number, number][] | undefined;
  if (rise && radial && shape !== 'flat') {
    profile =
      shape === 'cone'
        ? [
            [1, 0],
            [0, 1],
          ]
        : shape === 'onion'
          ? lod === 0
            ? [
                [1, 0],
                [1.12, 0.23],
                [1, 0.48],
                [0.65, 0.7],
                [0.25, 0.88],
                [0, 1],
              ]
            : [
                [1, 0],
                [1.1, 0.35],
                [0.45, 0.8],
                [0, 1],
              ]
          : lod === 0
            ? [
                [1, 0],
                [0.951, 0.309],
                [0.809, 0.588],
                [0.588, 0.809],
                [0.309, 0.951],
                [0, 1],
              ]
            : [
                [1, 0],
                [0.707, 0.707],
                [0, 1],
              ];
  }
  const planes: ((p: Point) => number)[] = [];
  const strips = (
    samples: [number, number][],
    coordinate: (p: Point) => number,
    min: number,
    span: number,
  ) => {
    for (let i = 1; i < samples.length; i++) {
      const [x0, y0] = samples[i - 1],
        [x1, y1] = samples[i];
      planes.push(
        (p) =>
          eaves +
          rise *
            (y0 +
              (((coordinate(p) - min) / span - x0) * (y1 - y0)) / (x1 - x0)),
      );
    }
  };
  if (!rise || profile) planes.push(() => (profile ? eaves : top));
  else if (shape === 'skillion')
    strips(
      [
        [0, 1],
        [1, 0],
      ],
      u,
      u0,
      width,
    );
  else {
    let samples: [number, number][] = [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ];
    if (shape === 'saltbox')
      samples = [
        [0, 0],
        [0.35, 1],
        [1, 0],
      ];
    if (lod === 0 && ['mansard', 'gambrel'].includes(shape))
      samples = [
        [0, 0],
        [0.22, 0.72],
        [0.5, 1],
        [0.78, 0.72],
        [1, 0],
      ];
    if (shape === 'round' && lod === 0)
      samples = Array.from({ length: 7 }, (_, i) => {
        const t = (Math.PI * i) / 6;
        return [(1 - Math.cos(t)) / 2, Math.sin(t)];
      });
    strips(samples, u, u0, width);
    if (['hipped', 'pyramidal', 'mansard', 'half-hipped'].includes(shape)) {
      const h =
        shape === 'pyramidal' || shape === 'mansard'
          ? depth / 2
          : Math.min(width, depth) / 2;
      const lift = shape === 'half-hipped' ? 0.55 : 0;
      if (shape === 'mansard' && lod === 0) strips(samples, v, v0, depth);
      else {
        planes.push((p) => eaves + rise * (lift + (v(p) - v0) / h));
        planes.push((p) => eaves + rise * (lift + (v1 - v(p)) / h));
      }
    }
  }
  return { shape, rise, eaves, planes, profile };
}
