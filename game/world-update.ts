import type { Edge, Point, World } from './types';
import { boundsOf, overlaps, type Bounds } from './geometry';
import { coverageBounds, routeHasCoverage } from './stream-coverage';
import { createRoutes } from './network';
export const edgeKey = (e: Edge) => `${e.way}/${e.from}/${e.to}`;
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
  const remap = new Map(next.edges.map((e) => [edgeKey(e), e.id]));
  const routes = previous.routes.flatMap((route) => {
    const ids = route.edges.map((id) => remap.get(edgeKey(previous.edges[id])));
    if (ids.some((id) => id === undefined || next.edges[id].blocked)) return [];
    if (
      !routeHasCoverage(
        route.points,
        next.loadedTiles,
        Math.max(120, ...ids.map((id) => next.edges[id!].width / 2 + 110)),
      )
    )
      return [];
    return [{ ...route, edges: ids as number[] }];
  });
  if (routes.length) {
    const generatedSpawn = next.spawnEdge;
    const spawn = previous.edges[previous.spawnEdge],
      id = spawn ? remap.get(edgeKey(spawn)) : undefined;
    if (id !== undefined && !next.edges[id].blocked) next.spawnEdge = id;
    // Сохраняем знакомый старт, но не скрываем новый вид заезда.
    for (const route of createRoutes(next))
      if (!routes.some((r) => r.kind === route.kind)) routes.push(route);
    if (routes.length < 2 && generatedSpawn !== next.spawnEdge)
      for (const route of createRoutes({ ...next, spawnEdge: generatedSpawn }))
        if (!routes.some((r) => r.kind === route.kind)) routes.push(route);
    next.routes = routes;
  } else next.routes = createRoutes(next);
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
  dirty.push(...coverageBounds(changed)!);
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
      old.values.length !== patch.values.length ||
      !old.values.every((v, i) => v === patch.values[i])
    ) {
      const x = patch.offsetX || 0,
        z = patch.offsetZ || 0;
      dirty.push({
        minX: x - patch.size / 2 - 60,
        maxX: x + patch.size / 2 + 60,
        minZ: z - patch.size / 2 - 60,
        maxZ: z + patch.size / 2 + 60,
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
