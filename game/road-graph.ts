import type { Edge, EdgeStableId, World } from './types';

// Длина и проходимость всегда относятся к окончательному профилю, в том числе
// после согласования подгруженной дороги с уже открытым соседним направлением.
export function updateRoadMetrics(edge: Edge) {
  let length = 0, steep = false;
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i];
    const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
    length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (Math.abs(b.y - a.y) / (horizontal || 1) > .38) steep = true;
  }
  edge.length = length;
  edge.blockedReasons = (edge.blockedReasons ?? []).filter(reason => reason !== 'grade');
  if (steep) edge.blockedReasons.push('grade');
  edge.blocked = edge.blockedReasons.length > 0;
}

export function makeEdgeStableId(
  way: number,
  from: number,
  to: number,
  segment: number,
): EdgeStableId {
  return `${way}/${from}/${to}/${segment}`;
}

export function edgeStableId(edge: Edge): EdgeStableId {
  return edge.stableId;
}

const edgeIndexes = new WeakMap<World, Map<EdgeStableId, number>>();

export function edgeIndex(world: World, stableId: EdgeStableId): number | undefined {
  let index = edgeIndexes.get(world);
  let result = index?.get(stableId);
  if (
    !index ||
    result === undefined ||
    !world.edges[result] ||
    edgeStableId(world.edges[result]) !== stableId
  ) {
    index = new Map(world.edges.map((edge, i) => [edgeStableId(edge), i]));
    edgeIndexes.set(world, index);
    result = index.get(stableId);
  }
  return result;
}

export function edgeById(world: World, stableId: EdgeStableId): Edge | undefined {
  const index = edgeIndex(world, stableId);
  return index === undefined ? undefined : world.edges[index];
}
