import type { Edge, Point, World } from './types';
import { boundsOf, overlaps, type Bounds } from './geometry';
import { coverageBounds } from './stream-coverage';
import { createRaceLocations, invalidateRaceRoutes } from './network';
import { edgeById, edgeStableId } from './road-graph';
export const edgeKey = edgeStableId;
// Уже построенную поверхность не меняем под автомобилями из-за нового
// соседнего перекрёстка. Доступность дороги берём из новой карты покрытия.
export function reconcileWorld(previous: World, next: World): World {
  const old = new Map(previous.edges.map((e) => [edgeKey(e), e]));
  for (const edge of next.edges) {
    const existing = old.get(edgeKey(edge));
    if (existing && !existing.unloaded && !existing.blocked) {
      edge.points = existing.points;
      edge.length = existing.length;
    }
  }
  const preferred = previous.routes.flatMap((route) => {
    const start = edgeById(previous, route.edges[0]),
      edge = start ? edgeById(next, edgeStableId(start)) : undefined;
    return edge ? [edgeStableId(edge)] : [];
  });
  const spawn = previous.spawnEdge ? edgeById(previous, previous.spawnEdge) : undefined,
    nextSpawn = spawn ? edgeById(next, edgeStableId(spawn)) : undefined;
  if (nextSpawn && !nextSpawn.blocked) next.spawnEdge = edgeStableId(nextSpawn);
  // Сохраняем места старта, но обновляем трассы и добавляем старты новых клеток.
  invalidateRaceRoutes(next);
  next.routes = createRaceLocations(next, preferred);
  return next;
}

// Длинная конструкция может изменить высоту далеко от новой клетки.
// Инвалидируем её целиком, включая старое положение удалённых объектов.
export function changedChunks(
  previous: World,
  next: World,
  installed: Iterable<string>,
): string[] {
  const dirty: Bounds[] = [];
  const oldCoverage = new Set(previous.loadedTiles),
    newCoverage = new Set(next.loadedTiles);
  const changed = [...new Set([...oldCoverage, ...newCoverage])].filter(
    (k) => oldCoverage.has(k) !== newCoverage.has(k),
  );
  dirty.push(...coverageBounds(changed, next.center)!);
  const samePoints = (a: Point[], b: Point[]) =>
    a.length === b.length &&
    a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.z === b[i].z);
  const roads = new Map(previous.edges.map((e) => [edgeKey(e), e]));
  const metadata = (e: Edge) =>
    JSON.stringify({
      ...e,
      id: 0,
      points: undefined,
      combinedLanes: undefined,
      sourceHeightRange: undefined,
      clearanceIssue: undefined,
      blockedReasons: undefined,
    });
  for (const edge of next.edges) {
    const old = roads.get(edgeKey(edge));
    if (
      !old ||
      !samePoints(old.points, edge.points) ||
      metadata(old) !== metadata(edge)
    ) {
      dirty.push(boundsOf(edge.points, edge.width / 2 + 60));
      if (old) dirty.push(boundsOf(old.points, old.width / 2 + 60));
    }
    roads.delete(edgeKey(edge));
  }
  for (const edge of roads.values())
    dirty.push(boundsOf(edge.points, edge.width / 2 + 60));
  function objects<T>(before: T[], after: T[], points: (o: T) => Point[]) {
    const old = new Map(before.map((o) => [JSON.stringify(o), o]));
    for (const o of after) {
      const key = JSON.stringify(o);
      if (!old.delete(key)) dirty.push(boundsOf(points(o), 60));
    }
    for (const o of old.values()) dirty.push(boundsOf(points(o), 60));
  }
  objects(previous.nodes, next.nodes, (p) => [p]);
  objects(previous.buildings, next.buildings, (b) => b.footprint);
  objects(previous.areas, next.areas, (a) => a.points);
  objects(previous.trees, next.trees, (p) => [p]);
  const patchKey = (p: World['elevation']) =>
    `${p.offsetX || 0},${p.offsetZ || 0}`;
  const patches = new Map(
    (previous.elevation.patches || [previous.elevation]).map((p) => [
      patchKey(p),
      p,
    ]),
  );
  for (const patch of next.elevation.patches || [next.elevation]) {
    const old = patches.get(patchKey(patch));
    if (
      !old ||
      old.width !== patch.width ||
      old.size !== patch.size ||
      old.sizeX !== patch.sizeX ||
      old.sizeZ !== patch.sizeZ ||
      old.values.length !== patch.values.length ||
      !old.values.every((v, i) => v === patch.values[i])
    ) {
      const x = patch.offsetX || 0,
        z = patch.offsetZ || 0,
        sizeX = patch.sizeX ?? patch.size,
        sizeZ = patch.sizeZ ?? patch.size;
      dirty.push({
        minX: x - sizeX / 2 - 60,
        maxX: x + sizeX / 2 + 60,
        minZ: z - sizeZ / 2 - 60,
        maxZ: z + sizeZ / 2 + 60,
      });
    }
  }
  return [...installed].filter((key) => {
    const [x, z] = key.split(',').map(Number);
    return dirty.some((b) =>
      overlaps(b, {
        minX: x * 250,
        maxX: (x + 1) * 250,
        minZ: z * 250,
        maxZ: (z + 1) * 250,
      }),
    );
  });
}
