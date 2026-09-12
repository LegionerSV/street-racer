import type { Edge, Point, World } from './types';
import { boundsOf, overlaps, type Bounds } from './geometry';
import { coverageBounds } from './stream-coverage';
import { createRaceLocations, invalidateRaceRoutes } from './network';
import { edgeById, edgeStableId } from './road-graph';
import { distance, distance2, smoother } from './geo';
export const edgeKey = edgeStableId;
// Уже построенную поверхность не меняем под автомобилями из-за нового
// соседнего перекрёстка. Доступность дороги берём из новой карты покрытия.
export function reconcileWorld(previous: World, next: World): World {
  const old = new Map(previous.edges.map((e) => [edgeKey(e), e]));
  const preserved = new Set<string>();
  for (const edge of next.edges) {
    const existing = old.get(edgeKey(edge));
    if (existing && !existing.unloaded && !existing.blocked) {
      edge.points = existing.points;
      edge.length = existing.length;
      preserved.add(edgeKey(edge));
    }
  }
  // Новая source-клетка может изменить DEM-профиль ещё не открытого
  // продолжения. Его торец должен остаться на высоте уже построенной
  // дороги; поправка плавно затухает внутри нового сегмента.
  const anchors = new Map<number, { sum: number; count: number }>();
  const addAnchor = (id: number, y: number) => {
    const anchor = anchors.get(id) ?? { sum: 0, count: 0 };
    anchor.sum += y;
    anchor.count++;
    anchors.set(id, anchor);
  };
  for (const edge of next.edges)
    if (preserved.has(edgeKey(edge))) {
      addAnchor(edge.from, edge.points[0].y);
      addAnchor(edge.to, edge.points.at(-1)!.y);
    }
  const anchorHeight = (id: number) => {
    const anchor = anchors.get(id);
    return anchor && anchor.sum / anchor.count;
  };
  for (const edge of next.edges) {
    if (preserved.has(edgeKey(edge)) || edge.points.length < 2) continue;
    const from = anchorHeight(edge.from),
      to = anchorHeight(edge.to);
    if (from === undefined && to === undefined) continue;
    const sourceFrom = edge.points[0].y,
      sourceTo = edge.points.at(-1)!.y,
      stations = [0];
    for (let i = 1; i < edge.points.length; i++)
      stations.push(
        stations[i - 1] + distance2(edge.points[i - 1], edge.points[i]),
      );
    const total = stations.at(-1) || 1,
      blend = Math.min(80, total);
    edge.points = edge.points.map((point, i) => {
      const fromWeight =
          from === undefined ? 0 : smoother(1 - stations[i] / blend),
        toWeight =
          to === undefined ? 0 : smoother(1 - (total - stations[i]) / blend),
        correction =
          fromWeight * ((from ?? sourceFrom) - sourceFrom) +
          toWeight * ((to ?? sourceTo) - sourceTo);
      return { ...point, y: point.y + correction };
    });
    edge.length = edge.points
      .slice(1)
      .reduce((sum, point, i) => sum + distance(edge.points[i], point), 0);
  }
  for (const node of next.nodes) {
    const y = anchorHeight(node.id);
    if (y !== undefined) node.y = y;
  }
  const preferred = previous.routes.flatMap((route) => {
    const start = edgeById(previous, route.edges[0]),
      edge = start ? edgeById(next, edgeStableId(start)) : undefined;
    return edge ? [edgeStableId(edge)] : [];
  });
  const spawn = previous.spawnEdge
      ? edgeById(previous, previous.spawnEdge)
      : undefined,
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
