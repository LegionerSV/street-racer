import { distance2, projectOnSegment } from './geo';
import type { Edge, Point } from './types';

export type CarriagewayJoin = {
  side: number;
  nearA: Point;
  nearB: Point;
  farA: Point;
  farB: Point;
  other: Edge;
  owner: boolean;
};
type Segment = { a: Point; b: Point; edge: Edge };
// Соединяем только узкий промежуток между встречными наземными проезжими
// частями одной улицы. Узлы маршрутов и ограничения поворотов сохраняются.
export function carriagewayJoin(
  s: Segment,
  candidates: Segment[],
  drivingSide: 'left' | 'right',
): CarriagewayJoin | undefined {
  const { a, b, edge } = s;
  if (
    !edge.oneWay ||
    edge.bridge ||
    edge.tunnel ||
    edge.passage ||
    edge.blocked ||
    edge.name === 'Безымянная улица' ||
    edge.category?.endsWith('_link')
  )
    return;
  const length = distance2(a, b),
    nx = (b.z - a.z) / length,
    nz = -(b.x - a.x) / length;
  const side = drivingSide === 'right' ? -1 : 1;
  let best: CarriagewayJoin | undefined,
    nearest = Infinity;
  const byWay = new Map<number, Set<Edge>>();
  for (const candidate of candidates) {
    const group = byWay.get(candidate.edge.way) ?? new Set<Edge>();
    group.add(candidate.edge);
    byWay.set(candidate.edge.way, group);
  }
  for (const group of byWay.values()) {
    const other = group.values().next().value!;
    if (
      other.way === edge.way ||
      !other.oneWay ||
      other.bridge ||
      other.tunnel ||
      other.passage ||
      other.blocked ||
      other.layer !== edge.layer ||
      other.name !== edge.name ||
      other.category !== edge.category
    )
      continue;
    const project = (p: Point) => {
      let best: { point: Point; distance: number } | undefined;
      for (const part of group)
        for (let i = 1; i < part.points.length; i++) {
          const c = part.points[i - 1],
            d = part.points[i],
            len = distance2(c, d);
          if (
            ((d.x - c.x) * (b.x - a.x) + (d.z - c.z) * (b.z - a.z)) /
              (len * length) >
            -0.985
          )
            continue;
          const q = projectOnSegment(p, c, d);
          // Торец соседней дороги не продолжается за пределы её геометрии.
          if (
            Math.abs(
              (q.point.x - p.x) * (b.x - a.x) + (q.point.z - p.z) * (b.z - a.z),
            ) /
              length >
            0.25
          )
            continue;
          if (!best || q.distance < best.distance) best = q;
        }
      return best;
    };
    const pa = project(a),
      pb = project(b);
    if (!pa || !pb) continue;
    const offsets = [
      (pa.point.x - a.x) * nx + (pa.point.z - a.z) * nz,
      (pb.point.x - b.x) * nx + (pb.point.z - b.z) * nz,
    ];
    const gap = offsets.map((d) => d * side - (edge.width + other.width) / 2);
    if (
      gap.some((d) => d < -1.6 || d > 2) ||
      Math.abs(pa.point.y - a.y) > 0.25 ||
      Math.abs(pb.point.y - b.y) > 0.25
    )
      continue;
    const distance = Math.max(...gap);
    if (distance >= nearest) continue;
    nearest = distance;
    const offset = (p: Point, d: number) => ({
      ...p,
      x: p.x + nx * d * side,
      z: p.z + nz * d * side,
    });
    best = {
      side,
      nearA: offset(a, edge.width / 2),
      nearB: offset(b, edge.width / 2),
      farA: offset(pa.point, -other.width / 2),
      farB: offset(pb.point, -other.width / 2),
      other,
      owner: edge.way < other.way,
    };
  }
  return best;
}
