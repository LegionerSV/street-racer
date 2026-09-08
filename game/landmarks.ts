import catalog from './landmarks/catalog.json';
import { projectOnSegment, tileKey, toLocal } from './geo';
import type { Center, MeshData, Point, World } from './types';
export type LandmarkAsset = {
  id: string;
  kind: 'building' | 'bridge';
  osm: { type: 'way' | 'relation'; id: number }[];
  anchor: Center;
  rotation?: number;
  source: string;
  license: string;
  near: MeshData;
  far?: MeshData;
};
type Placed = { asset: LandmarkAsset; origin: Point; key: string };
function valid(mesh: MeshData) {
  return (
    mesh.positions.length >= 9 &&
    mesh.positions.length % 3 === 0 &&
    mesh.positions.every(Number.isFinite) &&
    mesh.indices.length >= 3 &&
    mesh.indices.length % 3 === 0 &&
    mesh.indices.every(
      (i) => Number.isInteger(i) && i >= 0 && i < mesh.positions.length / 3,
    ) &&
    (!mesh.colors ||
      (mesh.colors.length === (mesh.positions.length / 3) * 4 &&
        mesh.colors.every(Number.isFinite)))
  );
}
export function prepareLandmarks(
  world: World,
  assets: LandmarkAsset[] = catalog,
) {
  const placed: Placed[] = [],
    claimed = new Set<string>();
  for (const asset of assets) {
    if (
      !asset.source ||
      !asset.license ||
      !valid(asset.near) ||
      (asset.far && !valid(asset.far)) ||
      !Number.isFinite(asset.anchor.lat) ||
      !Number.isFinite(asset.anchor.lon)
    )
      continue;
    const ids = asset.osm.map((ref) => `${ref.type}/${ref.id}`);
    if (ids.some((id) => claimed.has(id))) continue;
    const origin = toLocal(asset.anchor.lat, asset.anchor.lon, world.center);
    let owner: Point | undefined;
    if (asset.kind === 'building') {
      const b = world.buildings.find((b) =>
        ids.includes(`${b.osmType || 'way'}/${b.id}`),
      );
      if (!b) continue;
      origin.y = Math.min(...b.footprint.map((p) => p.y));
      owner = {
        x: b.footprint.reduce((s, p) => s + p.x, 0) / b.footprint.length,
        y: origin.y,
        z: b.footprint.reduce((s, p) => s + p.z, 0) / b.footprint.length,
      };
    } else {
      // Модель моста содержит надстройку над полотном; плита и расчёт просвета
      // остаются общими с дорожной геометрией. Опоры над дорогой не импортируются.
      if (
        asset.near.positions.some((v, i) => i % 3 === 1 && v < 0) ||
        asset.far?.positions.some((v, i) => i % 3 === 1 && v < 0)
      )
        continue;
      const roads = world.edges.filter(
        (e) => e.bridge && ids.includes(`way/${e.way}`),
      );
      const projected = roads
        .flatMap((e) =>
          e.points
            .slice(1)
            .map((p, i) => projectOnSegment(origin, e.points[i], p)),
        )
        .sort((a, b) => a.distance - b.distance)[0];
      if (!projected || projected.distance > 50) continue;
      origin.y = projected.point.y;
      owner = origin;
    }
    if (Math.hypot(origin.x - owner.x, origin.z - owner.z) > 100) continue;
    ids.forEach((id) => claimed.add(id));
    placed.push({ asset, origin, key: tileKey(owner.x, owner.z) });
  }
  return placed;
}
const cache = new WeakMap<World, Placed[]>();
export function worldLandmarks(world: World) {
  let models = cache.get(world);
  if (!models) {
    models = prepareLandmarks(world);
    cache.set(world, models);
  }
  return models;
}
export function appendLandmark(mesh: MeshData, placed: Placed, lod: number) {
  const data = lod === 0 ? placed.asset.near : placed.asset.far;
  if (!data) return false;
  const base = mesh.positions.length / 3,
    r = ((placed.asset.rotation || 0) * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  for (let i = 0; i < data.positions.length; i += 3) {
    const [x, y, z] = data.positions.slice(i, i + 3);
    mesh.positions.push(
      placed.origin.x + x * c + z * s,
      placed.origin.y + y,
      placed.origin.z - x * s + z * c,
    );
    mesh.colors!.push(
      ...(data.colors?.slice((i / 3) * 4, (i / 3) * 4 + 4) || [
        0.55, 0.57, 0.56, 1,
      ]),
    );
  }
  for (const i of data.indices) mesh.indices.push(i + base);
  return true;
}
