import { overlaps } from './geometry';
import { buildWorld } from './network';
import { parseSourceTileKey, sourceTileKey } from './source-tiles';
import { sourceTileLocalBounds } from './stream-coverage';
import type {
  Area,
  Building,
  OSMElement,
  Point,
  RegionData,
  Restriction,
  SourceTileData,
  World,
} from './types';
import { reconcileWorld } from './world-update';

const elementKey = (element: OSMElement) => `${element.type}/${element.id}`;
const restrictionKey = (restriction: Restriction) =>
  `${restriction.fromWay}/${restriction.toWay}/${restriction.via}/${restriction.viaWays?.join(',') ?? ''}/${restriction.kind ?? ''}`;

function sameTile(left: SourceTileData, right: SourceTileData) {
  if (left.checksum && right.checksum) return left.checksum === right.checksum;
  return left.elements === right.elements && left.elevation === right.elevation;
}

export class SourceTileRegistry {
  private constructor(
    private readonly tiles: Map<string, SourceTileData>,
    private readonly references: Map<string, string | string[]>,
  ) {}

  static fromRegion(region: RegionData) {
    if (!region.sourceTiles) return null;
    return SourceTileRegistry.fromTiles(region.sourceTiles);
  }

  private static fromTiles(sourceTiles: SourceTileData[]) {
    const tiles = new Map<string, SourceTileData>(),
      references = new Map<string, string | string[]>();
    for (const tile of sourceTiles) {
      parseSourceTileKey(tile.key);
      tiles.set(tile.key, tile);
      for (const element of tile.elements) {
        const key = elementKey(element),
          owners = references.get(key);
        if (!owners) references.set(key, tile.key);
        else if (typeof owners === 'string') {
          if (owners !== tile.key) references.set(key, [owners, tile.key]);
        } else if (!owners.includes(tile.key)) owners.push(tile.key);
      }
    }
    return new SourceTileRegistry(tiles, references);
  }

  stage(region: RegionData) {
    if (!region.sourceTiles)
      throw new Error('Обновление source-тайлов не содержит реестр тайлов.');
    const next = SourceTileRegistry.fromTiles(region.sourceTiles),
      changed = new Set<string>(),
      changedElements = new Set<string>();
    for (const [key, tile] of this.tiles)
      if (!next.tiles.has(key) || !sameTile(tile, next.tiles.get(key)!)) {
        changed.add(key);
        tile.elements.forEach((element) =>
          changedElements.add(elementKey(element)),
        );
      }
    for (const [key, tile] of next.tiles)
      if (!this.tiles.has(key) || !sameTile(tile, this.tiles.get(key)!)) {
        changed.add(key);
        tile.elements.forEach((element) =>
          changedElements.add(elementKey(element)),
        );
      }
    return { registry: next, changed: [...changed], changedElements };
  }

  stageUpdate(add: SourceTileData[], remove: string[]) {
    const tiles = new Map(this.tiles);
    remove.forEach((key) => tiles.delete(key));
    add.forEach((tile) => tiles.set(tile.key, tile));
    return this.stage({ sourceTiles: [...tiles.values()] } as RegionData);
  }

  referenceCount(key: string) {
    const owners = this.references.get(key);
    return owners ? typeof owners === 'string' ? 1 : owners.length : 0;
  }

  keys() {
    return [...this.tiles.keys()];
  }

  affectedTiles(
    changed: Iterable<string>,
    changedElements: Iterable<string> = [],
  ) {
    const affected = new Set<string>(),
      changedObjects = new Set(changedElements);
    for (const key of changed) {
      const id = parseSourceTileKey(key);
      affected.add(key);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const neighbour = sourceTileKey({
            z: id.z,
            x: id.x + dx,
            y: id.y + dy,
          });
          if (this.tiles.has(neighbour)) affected.add(neighbour);
        }
    }
    for (const key of affected)
      for (const element of this.tiles.get(key)?.elements ?? [])
        changedObjects.add(elementKey(element));
    for (const key of changedObjects) {
      const owners = this.references.get(key);
      if (typeof owners === 'string') affected.add(owners);
      else for (const owner of owners ?? []) affected.add(owner);
    }
    return [...affected];
  }

  regionFor(keys: Iterable<string>, metadata: RegionData): RegionData {
    const elements = new Map<string, OSMElement>();
    for (const key of keys)
      for (const element of this.tiles.get(key)?.elements ?? [])
        elements.set(elementKey(element), element);
    return {
      center: metadata.center,
      elements: [...elements.values()],
      elevation: {
        width: 2,
        size: 1,
        values: new Float32Array(4),
        patches: [...this.tiles.values()].map((tile) => tile.elevation),
      },
      drivingSide: metadata.drivingSide,
      fetchedAt: metadata.fetchedAt,
      loadedTiles: this.keys(),
      focus: metadata.focus,
      heightDatum: metadata.heightDatum,
    };
  }
}

function inBounds(
  point: Point,
  bounds: ReturnType<typeof sourceTileLocalBounds>[],
) {
  return bounds.some((bound) =>
    overlaps(bound, {
      minX: point.x,
      maxX: point.x,
      minZ: point.z,
      maxZ: point.z,
    }),
  );
}

function mergeByKey<T, K>(
  previous: T[],
  rebuilt: T[],
  affectedIds: Set<K>,
  key: (item: T) => K,
) {
  return [
    ...previous.filter((item) => !affectedIds.has(key(item))),
    ...rebuilt.filter((item) => affectedIds.has(key(item))),
  ];
}

const buildingKey = (building: Building) =>
  `${building.osmType ?? 'way'}/${building.id}`;
const areaKey = (area: Area) => `${area.osmType ?? 'way'}/${area.id}`;

function mergeBuildings(
  previous: Building[],
  rebuilt: Building[],
  affected: Set<string>,
) {
  return mergeByKey(previous, rebuilt, affected, buildingKey);
}

function mergeAreas(previous: Area[], rebuilt: Area[], affected: Set<string>) {
  return mergeByKey(previous, rebuilt, affected, areaKey);
}

export function buildIncrementalWorld(
  previous: World,
  registry: SourceTileRegistry,
  affectedTiles: string[],
  metadata: RegionData,
  changedElements: ReadonlySet<string> = new Set(),
  builder: (region: RegionData) => World = buildWorld,
) {
  const region = registry.regionFor(affectedTiles, metadata),
    rebuilt = builder(region),
    affectedElements = region.elements,
    affectedWays = new Set(
      affectedElements
        .filter((element) => element.type === 'way')
        .map((element) => element.id),
    ),
    affectedNodes = new Set(
      affectedElements
        .filter((element) => element.type === 'node')
        .map((element) => element.id),
    ),
    affectedObjects = new Set(
      affectedElements
        .filter(
          (element) => element.type === 'way' || element.type === 'relation',
        )
        .map((element) => elementKey(element)),
    ),
    bounds = affectedTiles.map((key) =>
      sourceTileLocalBounds(parseSourceTileKey(key), metadata.center),
    ),
    restrictionsAffected = (restriction: Restriction) =>
      affectedWays.has(restriction.fromWay) ||
      affectedWays.has(restriction.toWay) ||
      restriction.viaWays?.some((way) => affectedWays.has(way));
  for (const key of changedElements) {
    const [type, rawId] = key.split('/'),
      id = Number(rawId);
    if (type === 'way') affectedWays.add(id);
    if (type === 'node') affectedNodes.add(id);
    if (type === 'way' || type === 'relation') {
      affectedObjects.add(key);
    }
  }
  const edges = [
    ...previous.edges
      .filter((edge) => !affectedWays.has(edge.way))
      .map((edge) => ({ ...edge })),
    ...rebuilt.edges.filter((edge) => affectedWays.has(edge.way)),
  ];
  edges.forEach((edge, id) => (edge.id = id));
  const next: World = {
    ...previous,
    nodes: mergeByKey(previous.nodes, rebuilt.nodes, affectedNodes, node => node.id),
    edges,
    restrictions: [
      ...previous.restrictions.filter(
        (restriction) => !restrictionsAffected(restriction),
      ),
      ...rebuilt.restrictions.filter(restrictionsAffected),
    ].filter(
      (restriction, index, all) =>
        all.findIndex(
          (candidate) =>
            restrictionKey(candidate) === restrictionKey(restriction),
        ) === index,
    ),
    buildings: mergeBuildings(
      previous.buildings,
      rebuilt.buildings,
      affectedObjects,
    ),
    areas: mergeAreas(previous.areas, rebuilt.areas, affectedObjects),
    trees: [
      ...previous.trees.filter((tree) => !inBounds(tree, bounds)),
      ...rebuilt.trees.filter((tree) => inBounds(tree, bounds)),
    ],
    elevation: rebuilt.elevation,
    loadedTiles: registry.keys(),
    warnings: [...new Set([...previous.warnings, ...rebuilt.warnings])].slice(
      0,
      10,
    ),
  };
  return reconcileWorld(previous, next);
}
