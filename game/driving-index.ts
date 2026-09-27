import { SpatialGrid, boundsOf } from './geometry';
import { tileKey } from './geo';
import { coverageBounds } from './stream-coverage';
import type { Building, Edge, Point, World } from './types';

export type DrivingSegment = { a: Point; b: Point; edge: Edge };
type DrivingIndex = {
  segments: Map<string, DrivingSegment[]>;
  spatial: SpatialGrid<DrivingSegment>;
  buildings: Map<string, Building[]>;
  roads: Map<Edge, DrivingSegment[]>;
};
const indices = new WeakMap<World, DrivingIndex>();

export function indexDrivingWorld(world: World): DrivingIndex {
  const steps = prepareDrivingIndex(world);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function* prepareDrivingIndex(
  world: World,
  previous?: World,
): Generator<void, DrivingIndex> {
  const existing = indices.get(world);
  if (existing) return existing;
  const before = previous ? indices.get(previous) : undefined;
  const index: DrivingIndex = {
    segments: new Map(),
    spatial: new SpatialGrid(
      32,
      coverageBounds(world.loadedTiles, world.center),
    ),
    buildings: new Map(),
    roads: new Map(),
  };
  const seen = new Set<string>();
  let operations = 0;
  for (const edge of world.edges) {
    if (++operations % 32 === 0) yield;
    const physical = `${edge.way}/${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`;
    if (seen.has(physical)) continue;
    seen.add(physical);
    const reused = before?.roads.get(edge),
      segments: DrivingSegment[] = [];
    for (let i = 0; i < edge.points.length - 1; i++) {
      if (++operations % 32 === 0) yield;
      const segment = reused?.[i] ?? {
        a: edge.points[i],
        b: edge.points[i + 1],
        edge,
      };
      segments.push(segment);
      const bounds = boundsOf([segment.a, segment.b], edge.width / 2 + 35);
      index.spatial.add(segment, bounds);
      for (
        let x = Math.floor(bounds.minX / 250);
        x <= Math.floor(bounds.maxX / 250);
        x++
      )
        for (
          let z = Math.floor(bounds.minZ / 250);
          z <= Math.floor(bounds.maxZ / 250);
          z++
        ) {
          const key = `${x},${z}`,
            cell = index.segments.get(key) ?? [];
          cell.push(segment);
          index.segments.set(key, cell);
        }
    }
    index.roads.set(edge, segments);
  }
  for (const building of world.buildings) {
    if (++operations % 32 === 0) yield;
    const center = building.footprint.reduce(
      (sum, p) => ({
        x: sum.x + p.x / building.footprint.length,
        z: sum.z + p.z / building.footprint.length,
      }),
      { x: 0, z: 0 },
    );
    const key = tileKey(center.x, center.z),
      cell = index.buildings.get(key) ?? [];
    cell.push(building);
    index.buildings.set(key, cell);
  }
  indices.set(world, index);
  return index;
}
