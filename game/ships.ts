import earcut from 'earcut';
import type { Building, MeshData, Point, Tags } from './types';

type Colour = [number, number, number];

export function isShipTags(tags: Tags) {
  return (
    tags.building === 'ship' ||
    tags.building === 'houseboat' ||
    tags.historic === 'ship' ||
    !!tags['ship:type']
  );
}

export function shipShape(points: Point[]) {
  if (
    points.length < 3 ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))
  )
    return undefined;
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const z = points.reduce((sum, p) => sum + p.z, 0) / points.length;
  const xx = points.reduce((sum, p) => sum + (p.x - x) ** 2, 0);
  const zz = points.reduce((sum, p) => sum + (p.z - z) ** 2, 0);
  const xz = points.reduce((sum, p) => sum + (p.x - x) * (p.z - z), 0);
  const angle = Math.atan2(2 * xz, xx - zz) / 2;
  const forward = { x: Math.cos(angle), z: Math.sin(angle) };
  const right = { x: -forward.z, z: forward.x };
  const along = points.map(
    (p) => (p.x - x) * forward.x + (p.z - z) * forward.z,
  );
  const across = points.map((p) => (p.x - x) * right.x + (p.z - z) * right.z);
  const length = Math.max(...along) - Math.min(...along);
  const width = Math.max(...across) - Math.min(...across);
  const area =
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.z - q.x * p.z;
      }, 0),
    ) / 2;
  if (length < 3 || width < 1 || area < 3) return undefined;
  return { center: { x, y: 0, z }, forward, right, length, width };
}

function face(mesh: MeshData, points: Point[], colour: Colour) {
  const base = mesh.positions.length / 3;
  for (const p of points) {
    mesh.positions.push(p.x, p.y, p.z);
    mesh.colors!.push(...colour, 1);
  }
  for (let i = 1; i < points.length - 1; i++)
    mesh.indices.push(base, base + i, base + i + 1);
}

function orientedBox(
  mesh: MeshData,
  center: Point,
  forward: { x: number; z: number },
  right: { x: number; z: number },
  length: number,
  width: number,
  height: number,
  colour: Colour,
) {
  const corner = (l: number, w: number, y: number): Point => ({
    x: center.x + forward.x * l + right.x * w,
    y: center.y + y,
    z: center.z + forward.z * l + right.z * w,
  });
  const bottom = [
    corner(-length / 2, -width / 2, 0),
    corner(length / 2, -width / 2, 0),
    corner(length / 2, width / 2, 0),
    corner(-length / 2, width / 2, 0),
  ];
  const top = bottom.map((p) => ({ ...p, y: p.y + height }));
  for (let i = 0; i < 4; i++)
    face(
      mesh,
      [bottom[i], bottom[(i + 1) % 4], top[(i + 1) % 4], top[i]],
      colour,
    );
  face(mesh, top, colour);
}

export function appendShip(
  building: Building,
  mesh: MeshData,
  waterY: number,
  lod = 0,
) {
  const footprint = building.footprint;
  const shape = shipShape(footprint);
  if (!shape) return;
  const { center, forward, right, length, width } = shape;
  const restaurant =
    building.osmTags?.amenity === 'restaurant' || building.kind === 'houseboat';
  const hullColour: Colour = restaurant
    ? [0.31, 0.2, 0.16]
    : [0.19, 0.22, 0.25];
  const deckY = waterY + Math.min(4, Math.max(1.5, width * 0.22));
  const lower = footprint.map((p) => ({
    x: center.x + (p.x - center.x) * 0.79,
    y: waterY - 0.7,
    z: center.z + (p.z - center.z) * 0.79,
  }));
  const upper = footprint.map((p) => ({ ...p, y: deckY }));
  for (let i = 0; i < footprint.length; i++)
    face(
      mesh,
      [
        lower[i],
        lower[(i + 1) % footprint.length],
        upper[(i + 1) % footprint.length],
        upper[i],
      ],
      hullColour,
    );
  const triangles = earcut(upper.flatMap((p) => [p.x, p.z]));
  for (let i = 0; i < triangles.length; i += 3)
    face(
      mesh,
      [upper[triangles[i]], upper[triangles[i + 1]], upper[triangles[i + 2]]],
      restaurant ? [0.57, 0.47, 0.36] : [0.62, 0.59, 0.51],
    );
  const cabinHeight = restaurant
    ? 3.8
    : Math.min(5, Math.max(2.5, width * 0.34));
  orientedBox(
    mesh,
    { ...center, y: deckY },
    forward,
    right,
    length * (restaurant ? 0.53 : 0.34),
    width * 0.55,
    cabinHeight,
    restaurant ? [0.65, 0.55, 0.42] : [0.72, 0.73, 0.7],
  );
  if (lod > 0 || length < 25) return;
  const mastPosition = (offset: number): Point => ({
    x: center.x + forward.x * offset,
    y: deckY,
    z: center.z + forward.z * offset,
  });
  for (const offset of [-length * 0.27, length * 0.25])
    orientedBox(
      mesh,
      mastPosition(offset),
      forward,
      right,
      0.32,
      0.32,
      Math.min(17, length * 0.16),
      [0.66, 0.67, 0.64],
    );
  if (!restaurant)
    for (const offset of [-length * 0.14, length * 0.13])
      orientedBox(
        mesh,
        mastPosition(offset),
        forward,
        right,
        Math.min(4, length * 0.04),
        Math.min(4, width * 0.27),
        3,
        [0.27, 0.29, 0.29],
      );
}
