import { CURB_HEIGHT, CURB_WIDTH, SIDEWALK_WIDTH } from './clearance';
import { distance2, mixPoint, projectOnSegment } from './geo';
import type { Edge, Point } from './types';

type RoadSegment = {
  a: Point;
  b: Point;
  edge: Edge;
  na?: { x: number; z: number };
  nb?: { x: number; z: number };
  join?: { side: number };
};

const ROAD_MARGIN = 12;

export function parkFencePadding(roads: RoadSegment[]): number {
  return roads.reduce((padding, road) => {
    const offset = road.edge.width / 2 + CURB_WIDTH + SIDEWALK_WIDTH + 0.2;
    const normalLength = Math.max(
      1,
      road.na ? Math.hypot(road.na.x, road.na.z) : 1,
      road.nb ? Math.hypot(road.nb.x, road.nb.z) : 1,
    );
    return Math.max(
      padding,
      road.edge.width / 2 + ROAD_MARGIN + offset * normalLength,
    );
  }, 0);
}

export function parkFenceSpan(
  a: Point,
  b: Point,
  roads: RoadSegment[],
  terrainHeight: (x: number, z: number) => number,
  neighbours: { previous?: Point; next?: Point } = {},
): [Point, Point] | undefined {
  const mid = mixPoint(a, b, 0.5),
    spanLength = distance2(a, b);
  const closest = (point: Point, neighbour?: Point) => {
    let best: { road: RoadSegment; distance: number; side: number } | undefined;
    for (const road of roads) {
      if (
        road.edge.bridge ||
        road.edge.tunnel ||
        road.edge.tunnelApproach ||
        road.edge.layer !== 0
      )
        continue;
      const projected = projectOnSegment(point, road.a, road.b),
        length = distance2(road.a, road.b);
      const along =
        ((point.x - road.a.x) * (road.b.x - road.a.x) +
          (point.z - road.a.z) * (road.b.z - road.a.z)) /
        (length * length);
      if (
        !length ||
        !spanLength ||
        along < -0.000001 ||
        along > 1.000001 ||
        projected.distance > road.edge.width / 2 + ROAD_MARGIN
      )
        continue;
      const parallel =
        Math.abs(
          (b.x - a.x) * (road.b.x - road.a.x) +
            (b.z - a.z) * (road.b.z - road.a.z),
        ) /
        (length * spanLength);
      const neighbourLength = neighbour ? distance2(point, neighbour) : 0;
      const neighbourParallel =
        neighbour && neighbourLength
          ? Math.abs(
              (neighbour.x - point.x) * (road.b.x - road.a.x) +
                (neighbour.z - point.z) * (road.b.z - road.a.z),
            ) /
            (length * neighbourLength)
          : 0;
      if (Math.max(parallel, neighbourParallel) < 0.8) continue;
      const side =
        (point.x - projected.point.x) * (road.b.z - road.a.z) -
          (point.z - projected.point.z) * (road.b.x - road.a.x) >=
        0
          ? 1
          : -1;
      if (road.join?.side === side) continue;
      if (!best || projected.distance < best.distance)
        best = { road, distance: projected.distance, side };
    }
    return best;
  };
  const snap = (point: Point, neighbour?: Point): Point => {
    const best = closest(point, neighbour);
    if (!best) return { ...point, y: terrainHeight(point.x, point.z) };
    const { road, side } = best,
      length = distance2(road.a, road.b);
    const sidewalk =
      side < 0
        ? road.edge.sidewalkLeft !== false
        : road.edge.sidewalkRight !== false;
    const offset =
      road.edge.width / 2 +
      (sidewalk ? CURB_WIDTH + SIDEWALK_WIDTH : 0.2) +
      0.2;
    const normal = {
      x: (road.b.z - road.a.z) / length,
      z: -(road.b.x - road.a.x) / length,
    };
    const edge = (point: Point, n = normal): Point => ({
      x: point.x + n.x * offset * side,
      y: point.y + (sidewalk ? CURB_HEIGHT : 0),
      z: point.z + n.z * offset * side,
    });
    const start = edge(road.a, road.na),
      end = edge(road.b, road.nb);
    return mixPoint(start, end, projectOnSegment(point, road.a, road.b).t);
  };
  if (
    closest(mid) ||
    closest(a, neighbours.previous) ||
    closest(b, neighbours.next)
  ) {
    const p = snap(a, neighbours.previous),
      q = snap(b, neighbours.next);
    return distance2(p, q) > 0.1 ? [p, q] : undefined;
  }
  if (
    roads.some(
      (road) =>
        !road.edge.bridge &&
        !road.edge.tunnel &&
        !road.edge.tunnelApproach &&
        road.edge.layer === 0 &&
        projectOnSegment(mid, road.a, road.b).distance <
          road.edge.width / 2 + 0.2,
    )
  )
    return undefined;
  return [
    { ...a, y: terrainHeight(a.x, a.z) },
    { ...b, y: terrainHeight(b.x, b.z) },
  ];
}
