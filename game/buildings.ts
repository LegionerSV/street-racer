import { roofForm } from './roof-forms';
import earcut from 'earcut';
import {
  footprintPrism,
  roadPrism,
  subtractPrisms,
  type Prism,
} from './geometry';
import { distance2, mixPoint } from './geo';
import type { Building, MeshData, Point, Tags } from './types';
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
  dimgray: '#696969',
  dimgrey: '#696969',
  paleturquoise: '#afeeee',
  floralwhite: '#fffaf0',
  cadetblue: '#5f9ea0',
  lightgreen: '#90ee90',
  slategray: '#708090',
  slategrey: '#708090',
  darkgoldenrod: '#b8860b',
  firebrick: '#b22222',
  peachpuff: '#ffdab9',
  lightslategrey: '#778899',
  lightslategray: '#778899',
  aquamarine: '#7fffd4',
  peru: '#cd853f',
  darkslategrey: '#2f4f4f',
  darkslategray: '#2f4f4f',
  darkred: '#8b0000',
  olivedrab: '#6b8e23',
  burlywood: '#deb887',
  mediumseagreen: '#3cb371',
  chocolate: '#d2691e',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  lightcoral: '#f08080',
  darkseagreen: '#8fbc8f',
  lavender: '#e6e6fa',
  whitesmoke: '#f5f5f5',
  salmon: '#fa8072',
  gold: '#d4af37',
  silver: '#c0c0c0',
  copper: '#b87333',
  seagreen: '#2e8b57',
  darksalmon: '#e9967a',
  lightgrey: '#d3d3d3',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  darkgray: '#a9a9a9',
  orange: '#ffa500',
  pink: '#ffc0cb',
  lightblue: '#add8e6',
  darkgreen: '#006400',
  maroon: '#800000',
  olive: '#808000',
  wheat: '#f5deb3',
  ivory: '#fffff0',
  lightyellow: '#ffffe0',
};
export function facadeStyle(b: Building) {
  if (
    ['wood', 'timber', 'logs'].includes(b.material || '') ||
    (!b.material && b.appearance === 'cottage' && b.colour < 0.72)
  )
    return 3;
  return b.material === 'brick'
    ? 0
    : ['glass', 'metal', 'steel'].includes(b.material || '') ||
        ['office', 'commercial', 'industrial'].includes(b.kind || '')
      ? 2
      : 1;
}
export function hasExplicitWindows(tags: Tags) {
  const values = [tags.window, tags.windows, tags['building:windows']]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => !!value);
  const negative = new Set(['no', 'false', '0', 'none']);
  return values.length > 0 && !values.some((value) => negative.has(value));
}

export function windowsForbiddenByTags(tags: Tags) {
  const values = [tags.window, tags.windows, tags['building:windows']]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => !!value);
  const part = tags['building:part'] || '';
  return (
    values.some((value) => ['no', 'false', '0', 'none'].includes(value)) ||
    [
      'bridge',
      'bunker',
      'carport',
      'roof',
      'shelter',
      'storage_tank',
      'triumphal_arch',
      'ventilation_kiosk',
      'wall',
    ].includes(tags.building || '') ||
    ['citywalls', 'city_wall'].includes(tags.historic || '') ||
    ['city_wall', 'wall'].includes(tags.barrier || '') ||
    /^(abacus|architrav|baraban|base|column|cornice|cross|dome|pedestal|pediment|plinth|portico|pylon|roof|rotunda|spire|steps?|stilobate|stylobate|wall)/.test(
      part,
    )
  );
}

export function hasFacadeWindows(b: Building) {
  const tags = b.osmTags || {};
  return (
    b.windowPolicy !== 'forbid' &&
    !windowsForbiddenByTags(tags) &&
    !['triumphal_arch', 'wall', 'fortification'].includes(b.kind || '')
  );
}

function triumphalOpening(b: Building, foundationFloor?: number) {
  const ring = b.footprint;
  let longest = 0,
    ux = 1,
    uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      q = ring[(i + 1) % ring.length],
      length = distance2(a, q);
    if (length > longest) {
      longest = length;
      ux = (q.x - a.x) / length;
      uz = (q.z - a.z) / length;
    }
  }
  const center = ring.reduce(
    (p, q) => ({ x: p.x + q.x / ring.length, z: p.z + q.z / ring.length }),
    { x: 0, z: 0 },
  );
  const vx = -uz,
    vz = ux;
  const depth = Math.max(
    ...ring.map((p) => Math.abs((p.x - center.x) * vx + (p.z - center.z) * vz)),
  );
  const floor = (foundationFloor ?? Math.min(...ring.map((p) => p.y))) - 0.3;
  const width = Math.min(14, longest * 0.42),
    rise = Math.min(14, b.height * 0.58);
  const point = (side: number, end: number, y: number): Point => ({
    x: center.x + (ux * side * width) / 2 + vx * end * depth,
    y,
    z: center.z + (uz * side * width) / 2 + vz * end * depth,
  });
  const mask = roadPrism(
    {
      x: center.x - vx * (depth + 2),
      y: floor,
      z: center.z - vz * (depth + 2),
    },
    {
      x: center.x + vx * (depth + 2),
      y: floor,
      z: center.z + vz * (depth + 2),
    },
    width,
    10000,
    rise,
  );
  return {
    mask,
    interior: [
      ...[-1, 1].map((side) => [
        point(side, -1, floor),
        point(side, 1, floor),
        point(side, 1, floor + rise),
        point(side, -1, floor + rise),
      ]),
      [
        point(-1, -1, floor + rise),
        point(1, -1, floor + rise),
        point(1, 1, floor + rise),
        point(-1, 1, floor + rise),
      ],
    ],
  };
}
function parsedColour(value?: string): Colour | undefined {
  let hex = named[value?.toLowerCase() || ''] || value || '';
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
  return undefined;
}
function colour(b: Building): Colour {
  const explicit = parsedColour(b.facadeColour);
  if (explicit) return explicit;
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
    [
      [0.48, 0.35, 0.25],
      [0.56, 0.44, 0.31],
      [0.39, 0.3, 0.24],
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

export function appendBuildingSilhouette(
  b: Building,
  mesh: MeshData,
  foundationFloor?: number,
) {
  const rings = [b.footprint, ...(b.holes || [])],
    flat = rings.flat(),
    holes: number[] = [];
  let count = b.footprint.length;
  for (const ring of rings.slice(1)) {
    holes.push(count);
    count += ring.length;
  }
  const floor =
      (foundationFloor ?? Math.min(...flat.map((p) => p.y))) +
      (b.supportMinHeight ?? b.minHeight ?? 0) -
      0.3,
    top = Math.max(...flat.map((p) => p.y)) + b.height,
    wallColour = colour(b),
    roofColour =
      parsedColour(b.roofColour) || (wallColour.map((v) => v * 0.48) as Colour);
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        next = ring[(i + 1) % ring.length];
      emitPolygon(
        mesh,
        [
          { ...a, y: floor },
          { ...next, y: floor },
          { ...next, y: top },
          { ...a, y: top },
        ],
        wallColour,
      );
    }
  const indices = earcut(
    flat.flatMap((p) => [p.x, p.z]),
    holes,
  );
  for (let i = 0; i < indices.length; i += 3)
    emitPolygon(
      mesh,
      indices.slice(i, i + 3).map((index) => ({ ...flat[index], y: top })),
      roofColour,
    );
}
export function appendBuilding(
  b: Building,
  lod: number,
  shell: MeshData,
  facades: MeshData[],
  openings: Prism[] = [],
  foundationFloor?: number,
  detailedEdge?: (ring: Point[], index: number) => boolean,
  bareFacades: MeshData[] = [],
) {
  if (b.envelopeHeight !== undefined)
    b = { ...b, height: b.envelopeHeight, roof: 'flat', roofHeight: 0 };
  // Вдали убирается только мелкий декор уже связанного комплекса.
  // Узкие высокие башни и отдельные верхушки остаются самостоятельными.
  if (lod > 0 && b.part && b.group && b.height - (b.minHeight || 0) < 2) {
    const xs = b.footprint.map((p) => p.x),
      zs = b.footprint.map((p) => p.z);
    if (
      Math.max(...xs) - Math.min(...xs) < 2 &&
      Math.max(...zs) - Math.min(...zs) < 2
    )
      return;
  }
  const windowed = hasFacadeWindows(b),
    textured = windowed,
    detailed = lod === 0 && !(b.part && b.group) && windowed;
  const bare = !windowed;
  const gateOpening =
    b.kind === 'triumphal_arch'
      ? triumphalOpening(b, foundationFloor)
      : undefined;
  const masks = gateOpening ? [...openings, gateOpening.mask] : openings;
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
    for (const piece of subtractPrisms(vertices, masks))
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
      (b.supportMinHeight ?? b.minHeight ?? 0) -
      0.3;
  const top = Math.max(...flat.map((p) => p.y)) + b.height,
    c = colour(b),
    roofColour: Colour =
      parsedColour(b.roofColour) ||
      parsedColour(
        (
          {
            gold: 'gold',
            copper: 'copper',
            zinc: 'silver',
            steel: 'grey',
            metal: 'grey',
            tar_paper: 'black',
            roof_tiles: 'brown',
            slate: 'grey',
            glass: 'lightblue',
          } as Record<string, string>
        )[b.roofMaterial || ''],
      ) ||
      (c.map((v) => v * 0.48) as Colour);
  const xs = b.footprint.map((p) => p.x),
    zs = b.footprint.map((p) => p.z);
  const roofLod =
    b.part &&
    b.group &&
    Math.max(...xs) - Math.min(...xs) < 6 &&
    Math.max(...zs) - Math.min(...zs) < 6 &&
    b.height - (b.minHeight || 0) < 3
      ? Math.max(1, lod)
      : lod;
  const { rise, eaves, planes, profile } = roofForm(
    b,
    roofLod,
    top,
    Math.max(...flat.map((p) => p.y)) + (b.minHeight || 0),
  );
  const roofY = (p: Point) => Math.min(...planes.map((plane) => plane(p)));
  for (const side of gateOpening?.interior || []) emitPolygon(shell, side, c);
  const style = facadeStyle(b),
    technicalHeight = b.technicalHeight || 0,
    floorHeight = Math.max(
      2.5,
      (eaves - floor) /
        Math.max(1, b.levels ?? Math.round((eaves - floor) / 3.2)),
    );
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const allowed = !detailedEdge || detailedEdge(ring, i),
        edgeTextured = textured && allowed,
        edgeDetailed = detailed && allowed,
        edgeBare = bare && allowed;
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        length = distance2(a, b),
        cuts = [0, 1];
      const facade = edgeTextured
        ? facades[style]
        : edgeBare
          ? bareFacades[style] || shell
          : shell;
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
        const uv = (
          textured: boolean,
          low: number,
          highA: number,
          highB: number,
        ) =>
          textured
            ? [
                (cuts[j - 1] * length) / 3.6,
                (low - floor) / floorHeight,
                (cuts[j] * length) / 3.6,
                (low - floor) / floorHeight,
                (cuts[j] * length) / 3.6,
                (highB - floor) / floorHeight,
                (cuts[j - 1] * length) / 3.6,
                (highA - floor) / floorHeight,
              ]
            : undefined;
        const technical = technicalHeight,
          technicalA = Math.max(floor, ya - technical),
          technicalB = Math.max(floor, yb - technical);
        if (edgeDetailed && technical > 0) {
          polygon(
            facade,
            [
              { ...start, y: floor },
              { ...end, y: floor },
              { ...end, y: technicalB },
              { ...start, y: technicalA },
            ],
            c,
            uv(true, floor, technicalA, technicalB),
          );
          polygon(
            bareFacades[style] || shell,
            [
              { ...start, y: technicalA },
              { ...end, y: technicalB },
              { ...end, y: yb },
              { ...start, y: ya },
            ],
            c,
            uv(!!bareFacades[style], technicalA, ya, yb),
          );
        } else if (edgeTextured && (ya > eaves + 1e-6 || yb > eaves + 1e-6)) {
          const windowTopA = Math.min(ya, Math.max(floor, eaves)),
            windowTopB = Math.min(yb, Math.max(floor, eaves));
          polygon(
            facade,
            [
              { ...start, y: floor },
              { ...end, y: floor },
              { ...end, y: windowTopB },
              { ...start, y: windowTopA },
            ],
            c,
            uv(true, floor, windowTopA, windowTopB),
          );
          polygon(
            bareFacades[style] || shell,
            [
              { ...start, y: windowTopA },
              { ...end, y: windowTopB },
              { ...end, y: yb },
              { ...start, y: ya },
            ],
            c,
            uv(!!bareFacades[style], windowTopA, ya, yb),
          );
        } else
          polygon(
            facade,
            [
              { ...start, y: floor },
              { ...end, y: floor },
              { ...end, y: yb },
              { ...start, y: ya },
            ],
            c,
            uv(edgeTextured || edgeBare, floor, ya, yb),
          );
      }
      if (edgeDetailed) {
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
    for (let j = 0; !profile && j < planes.length; j++) {
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
  if (profile) {
    const center = b.footprint.reduce(
      (p, q) => ({
        x: p.x + q.x / b.footprint.length,
        y: 0,
        z: p.z + q.z / b.footprint.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    const at = (p: Point, radius: number, y: number) => ({
      x: center.x + (p.x - center.x) * radius,
      y: eaves + rise * y,
      z: center.z + (p.z - center.z) * radius,
    });
    for (let j = 1; j < profile.length; j++)
      for (let i = 0; i < b.footprint.length; i++) {
        const a = b.footprint[i],
          bNext = b.footprint[(i + 1) % b.footprint.length],
          [r0, y0] = profile[j - 1],
          [r1, y1] = profile[j];
        polygon(
          shell,
          r1 === 0
            ? [at(a, r0, y0), at(bNext, r0, y0), at(a, 0, y1)]
            : [
                at(a, r0, y0),
                at(bNext, r0, y0),
                at(bNext, r1, y1),
                at(a, r1, y1),
              ],
          roofColour,
        );
      }
  }
}
