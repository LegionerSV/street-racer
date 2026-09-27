import type { Edge, Point } from './types';
import { distance2, projectOnSegment } from './geo';
type SpawnSegment = {
  edge: Edge;
  start: number;
  end: number;
  main: boolean;
  weight: number;
};
export function trafficSpawnSegments(
  edges: Edge[],
  player: Point,
  heading: number,
  radius: number,
): SpawnSegment[] {
  let current: Edge | undefined,
    nearest = Infinity;
  for (const edge of edges)
    if (!edge.blocked)
      for (let i = 1; i < edge.points.length; i++) {
        const projection = projectOnSegment(
          player,
          edge.points[i - 1],
          edge.points[i],
        );
        const score =
          projection.distance + Math.abs(projection.point.y - player.y) * 5;
        if (score < nearest) {
          nearest = score;
          current = edge;
        }
      }
  const result: SpawnSegment[] = [];
  for (const edge of edges) {
    if (edge.blocked || edge.length < 8) continue;
    let station = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1],
        b = edge.points[i],
        length = distance2(a, b);
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
              (end - start) *
              Math.max(1, edge.lanes) *
              (forward >= 0 ? 1.5 : 1),
          });
      }
      station += length;
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
