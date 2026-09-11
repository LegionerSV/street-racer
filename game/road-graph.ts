import type { Edge, EdgeStableId, World } from './types';

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
