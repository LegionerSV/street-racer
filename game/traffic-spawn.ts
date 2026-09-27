import type { Edge, Point } from './types';
import { distance2, projectOnSegment } from './geo';
import { boundsOf, SpatialGrid } from './geometry';
type SpawnSegment = {
  edge: Edge;
  start: number;
  end: number;
  main: boolean;
  weight: number;
};
type IndexedSegment = {
  edge: Edge;
  a: Point;
  b: Point;
  station: number;
  length: number;
  order: number;
};
const spawnIndices = new WeakMap<
  Edge[],
  { spatial: SpatialGrid<IndexedSegment>; segments: IndexedSegment[] }
>();

function viewPosition(point: Point, player: Point, heading: number) {
  const dx = point.x - player.x,
    dz = point.z - player.z;
  return {
    ahead: dx * Math.sin(heading) + dz * Math.cos(heading),
    across: dx * Math.cos(heading) - dz * Math.sin(heading),
  };
}

export function trafficEntryFrontier(
  player: Point,
  heading: number,
  visible: Point[],
  mobile: boolean,
) {
  let frontier = mobile ? 180 : 280;
  for (const point of visible) {
    if (Math.abs(point.y - player.y) > 6) continue;
    const { ahead, across } = viewPosition(point, player, heading);
    if (ahead > 0 && Math.abs(across) <= ahead * 1.25 + 25)
      frontier = Math.max(frontier, ahead + 25);
  }
  return frontier;
}

export function trafficEntryAllowed(
  point: Point,
  player: Point,
  heading: number,
  frontier: number,
) {
  const { ahead, across } = viewPosition(point, player, heading);
  return (
    ahead <= 0 || Math.abs(across) > ahead * 1.25 + 25 || ahead >= frontier
  );
}

export function trafficAhead(point: Point, player: Point, heading: number) {
  const { ahead } = viewPosition(point, player, heading);
  return ahead >= distance2(point, player) * 0.3;
}

function spawnIndex(edges: Edge[]) {
  const cached = spawnIndices.get(edges);
  if (cached) return cached;
  const steps = prepareTrafficSpawnIndex(edges);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function* prepareTrafficSpawnIndex(edges: Edge[]) {
  const cached = spawnIndices.get(edges);
  if (cached) return cached;
  const spatial = new SpatialGrid<IndexedSegment>(128),
    segments: IndexedSegment[] = [];
  for (const edge of edges) {
    let station = 0;
    for (let i = 1; i < edge.points.length; i++) {
      if (segments.length % 32 === 0) yield;
      const a = edge.points[i - 1],
        b = edge.points[i],
        length = distance2(a, b);
      const segment = { edge, a, b, station, length, order: segments.length };
      segments.push(segment);
      spatial.add(segment, boundsOf([a, b]));
      station += length;
    }
  }
  const index = { spatial, segments };
  spawnIndices.set(edges, index);
  return index;
}
export function trafficSpawnSegments(
  edges: Edge[],
  player: Point,
  heading: number,
  radius: number,
): SpawnSegment[] {
  let current: Edge | undefined,
    nearest = Infinity;
  const index = spawnIndex(edges);
  const nearby = index.spatial
    .query(boundsOf([player], radius))
    .sort((a, b) => a.order - b.order);
  const findCurrent = (segments: IndexedSegment[]) => {
    for (const { edge, a, b } of segments)
      if (!edge.blocked) {
        const projection = projectOnSegment(player, a, b);
        const score =
          projection.distance + Math.abs(projection.point.y - player.y) * 5;
        if (score < nearest) {
          nearest = score;
          current = edge;
        }
      }
  };
  findCurrent(nearby);
  // Высота может сделать далёкую дорогу ближе по оценке, чем мост над игроком.
  if (nearest > radius) {
    nearest = Infinity;
    findCurrent(index.segments);
  }
  const result: SpawnSegment[] = [];
  for (const { edge, a, b, station, length } of nearby) {
    if (edge.blocked || edge.length < 8) continue;
    if (!length) continue;
    const projection = projectOnSegment(player, a, b);
    if (
      projection.distance < radius &&
      Math.abs(projection.point.y - player.y) < 8
    ) {
      const along =
        ((player.x - a.x) * (b.x - a.x) + (player.z - a.z) * (b.z - a.z)) /
        length;
      const perpendicularSquared = Math.max(
        0,
        (player.x - a.x) ** 2 + (player.z - a.z) ** 2 - along * along,
      );
      const reach = Math.sqrt(
        Math.max(0, radius * radius - perpendicularSquared),
      );
      const start = Math.max(0, along - reach),
        end = Math.min(length, along + reach);
      const main =
        !!current &&
        (edge.way === current.way ||
          (!!current.name &&
            current.name !== 'Безымянная улица' &&
            edge.name === current.name));
      const forward =
        (projection.point.x - player.x) * Math.sin(heading) +
        (projection.point.z - player.z) * Math.cos(heading);
      if (end - start > 8)
        result.push({
          edge,
          start: station + start,
          end: station + end,
          main,
          weight:
            (end - start) * Math.max(1, edge.lanes) * (forward >= 0 ? 1.5 : 1),
        });
    }
  }
  return result;
}
export function chooseTrafficSpawn(
  candidates: SpawnSegment[],
  selection: number,
  position: number,
) {
  const main = candidates.filter((c) => c.main),
    side = candidates.filter((c) => !c.main);
  const pool =
    main.length && side.length ? (selection < 0.7 ? main : side) : candidates;
  if (!pool.length) return;
  const fraction =
    main.length && side.length
      ? selection < 0.7
        ? selection / 0.7
        : (selection - 0.7) / 0.3
      : selection;
  let remaining = fraction * pool.reduce((sum, c) => sum + c.weight, 0);
  const chosen =
    pool.find((c) => (remaining -= c.weight) < 0) || pool[pool.length - 1];
  return {
    edge: chosen.edge,
    distance: chosen.start + (chosen.end - chosen.start) * position,
  };
}
export function laneSpawnClearance(
  candidate: { point: Point; heading: number },
  player: Point,
  traffic: { point: Point; heading: number }[],
) {
  if (distance2(candidate.point, player) < 60) return false;
  return traffic.every((other) => {
    if (Math.abs(other.point.y - candidate.point.y) > 3) return true;
    const dx = other.point.x - candidate.point.x,
      dz = other.point.z - candidate.point.z;
    const along = Math.abs(
      dx * Math.sin(candidate.heading) + dz * Math.cos(candidate.heading),
    );
    const across = Math.abs(
      dx * Math.cos(candidate.heading) - dz * Math.sin(candidate.heading),
    );
    const angle = other.heading - candidate.heading;
    return (
      along > 7 + Math.abs(Math.sin(angle)) * 2 ||
      across > 2.8 + Math.abs(Math.sin(angle)) * 2.5
    );
  });
}
