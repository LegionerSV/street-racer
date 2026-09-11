import { boundsOf, type Bounds } from './geometry';
import { coverageBounds } from './stream-coverage';
import type {
  Area,
  Building,
  Edge,
  ElevationGrid,
  Point,
  Restriction,
  RoadNode,
  Route,
  World,
  WorldPatch,
} from './types';
import { changedChunks, edgeKey } from './world-update';

const json = (value: unknown) => JSON.stringify(value);
const restrictionKey = (restriction: Restriction) =>
  `${restriction.fromWay}/${restriction.toWay}/${restriction.via}/${restriction.viaWays?.join(',') ?? ''}/${restriction.kind ?? ''}`;
const elevationKey = (grid: ElevationGrid) =>
  `${grid.offsetX ?? 0},${grid.offsetZ ?? 0}`;
const pointKey = (point: Point) => `${point.x}/${point.y}/${point.z}`;
const areaKey = (area: Area) => `${area.osmType ?? 'way'}/${area.id}`;

function delta<T>(before: T[], after: T[], key: (value: T) => string) {
  const old = new Map(before.map((value) => [key(value), value])),
    addedOrUpdated: T[] = [];
  for (const value of after) {
    const id = key(value),
      previous = old.get(id);
    if (!previous || json(previous) !== json(value)) addedOrUpdated.push(value);
    old.delete(id);
  }
  return { addedOrUpdated, removed: [...old.values()] };
}

function candidateChunks(previous: World, next: World) {
  const bounds: Bounds[] = [
    ...(coverageBounds(previous.loadedTiles, previous.center) ?? []),
    ...(coverageBounds(next.loadedTiles, next.center) ?? []),
  ];
  const addPoints = (points: Point[]) =>
    points.length && bounds.push(boundsOf(points, 80));
  for (const world of [previous, next]) {
    world.edges.forEach((edge) => addPoints(edge.points));
    world.buildings.forEach((building) => addPoints(building.footprint));
    world.areas.forEach((area) => addPoints(area.points));
    world.trees.forEach((tree) => addPoints([tree]));
  }
  const chunks = new Set<string>();
  for (const bound of bounds)
    for (
      let x = Math.floor(bound.minX / 250);
      x <= Math.floor(bound.maxX / 250);
      x++
    )
      for (
        let z = Math.floor(bound.minZ / 250);
        z <= Math.floor(bound.maxZ / 250);
        z++
      )
        chunks.add(`${x},${z}`);
  return chunks;
}

export function createWorldPatch(previous: World, next: World): WorldPatch {
  const oldCoverage = new Set(previous.loadedTiles),
    newCoverage = new Set(next.loadedTiles),
    nodes = delta<RoadNode>(previous.nodes, next.nodes, (node) =>
      String(node.id),
    ),
    edges = delta<Edge>(previous.edges, next.edges, edgeKey),
    restrictions = delta<Restriction>(
      previous.restrictions,
      next.restrictions,
      restrictionKey,
    ),
    buildings = delta<Building>(
      previous.buildings,
      next.buildings,
      (building) => `${building.osmType ?? 'way'}/${building.id}`,
    ),
    areas = delta<Area>(previous.areas, next.areas, areaKey),
    trees = delta<Point>(previous.trees, next.trees, pointKey),
    elevation = delta<ElevationGrid>(
      previous.elevation.patches ?? [previous.elevation],
      next.elevation.patches ?? [next.elevation],
      elevationKey,
    ),
    routes = delta<Route>(previous.routes, next.routes, (route) => route.id);
  return {
    coverageAdded: [...newCoverage].filter((key) => !oldCoverage.has(key)),
    coverageRemoved: [...oldCoverage].filter((key) => !newCoverage.has(key)),
    nodesAddedOrUpdated: nodes.addedOrUpdated,
    nodesRemoved: nodes.removed.map((node) => node.id),
    edgesAddedOrUpdated: edges.addedOrUpdated,
    edgesRemoved: edges.removed.map(edgeKey),
    restrictionsAddedOrUpdated: restrictions.addedOrUpdated,
    restrictionsRemoved: restrictions.removed,
    buildingsAddedOrUpdated: buildings.addedOrUpdated,
    buildingsRemoved: buildings.removed.map((building) => ({
      id: building.id,
      osmType: building.osmType,
    })),
    areasAddedOrUpdated: areas.addedOrUpdated,
    areasRemoved: areas.removed.map((area) => ({
      id: area.id,
      osmType: area.osmType,
    })),
    treesAdded: trees.addedOrUpdated,
    treesRemoved: trees.removed,
    elevationPatches: elevation.addedOrUpdated,
    elevationPatchesRemoved: elevation.removed.map(elevationKey),
    dirtyChunks: changedChunks(previous, next, candidateChunks(previous, next)),
    invalidatedRoutes: [
      ...routes.removed.map((route) => route.id),
      ...routes.addedOrUpdated.map((route) => route.id),
    ],
  };
}
