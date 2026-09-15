import { buildingGroups, isBuildingPart } from './building-groups';
import { toLocal } from './geo';
import { ROAD_TYPES } from './map-object-filters';
import type { Center, OSMElement } from './types';

const FRONTAGE_METERS = 30;
const STREET_TREE_METERS = 20;
const GRID_METERS = 150;
const roadTypes = new Set<string>(ROAD_TYPES);

export type MapDetailMode = 'standard' | 'minimal' | 'roads';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export type ElementBreakdown = {
  total: number;
  nodes: number;
  ways: number;
  relations: number;
  roads: number;
  buildings: number;
  buildingParts: number;
  trees: number;
  areas: number;
};

export type ElementReductionStats = {
  raw: ElementBreakdown;
  kept: ElementBreakdown;
};

const keyOf = (element: OSMElement) => `${element.type}/${element.id}`;

function isRoad(element: OSMElement) {
  const tags = element.tags ?? {};
  return (
    element.type === 'way' &&
    !!element.nodes?.length &&
    roadTypes.has(tags.highway) &&
    tags.area !== 'yes' &&
    tags.access !== 'no' &&
    tags.access !== 'private' &&
    tags.motor_vehicle !== 'no' &&
    tags.motorcar !== 'no'
  );
}

function isCourtyardRoad(element: OSMElement) {
  const tags = element.tags ?? {};
  return tags.highway === 'service' &&
    !tags.bridge && (!tags.tunnel || tags.tunnel === 'building_passage') &&
    !tags.name && !tags['name:ru'] && !tags.ref &&
    (tags.service === 'driveway' || tags.service === 'parking_aisle' ||
      !tags.service || tags.service === 'alley');
}

function isArea(element: OSMElement) {
  const tags = element.tags ?? {};
  return (
    ['water', 'wood'].includes(tags.natural) ||
    tags.waterway === 'riverbank' ||
    ['forest', 'grass', 'meadow', 'reservoir'].includes(tags.landuse) ||
    tags.leisure === 'park'
  );
}

function isCourtyardGround(element: OSMElement) {
  const tags = element.tags ?? {};
  return (
    (tags.landuse === 'grass' || tags.landuse === 'meadow') &&
    tags.leisure !== 'park'
  );
}

function summarize(elements: OSMElement[]): ElementBreakdown {
  const result: ElementBreakdown = {
    total: elements.length,
    nodes: 0,
    ways: 0,
    relations: 0,
    roads: 0,
    buildings: 0,
    buildingParts: 0,
    trees: 0,
    areas: 0,
  };
  for (const element of elements) {
    if (element.type === 'node') result.nodes++;
    else if (element.type === 'way') result.ways++;
    else result.relations++;
    const tags = element.tags ?? {};
    if (tags.highway && element.type === 'way') result.roads++;
    if (tags['building:part']) result.buildingParts++;
    else if (tags.building) result.buildings++;
    if (tags.natural === 'tree' && element.type === 'node') result.trees++;
    if (isArea(element)) result.areas++;
  }
  return result;
}

function overlap(a: Bounds, b: Bounds, margin = 0) {
  return (
    a.minX <= b.maxX + margin &&
    a.maxX >= b.minX - margin &&
    a.minZ <= b.maxZ + margin &&
    a.maxZ >= b.minZ - margin
  );
}

function cell(value: number) {
  return Math.floor(value / GRID_METERS);
}

function streetIndex(
  roads: OSMElement[],
  point: (id: number) => { x: number; z: number } | undefined,
) {
  const cells = new Map<string, Bounds[]>(),
    longSegments: Bounds[] = [];
  for (const road of roads) {
    const ids = road.nodes ?? [];
    for (let i = 1; i < ids.length; i++) {
      const a = point(ids[i - 1]),
        b = point(ids[i]);
      if (!a || !b) continue;
      const bounds = {
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          minZ: Math.min(a.z, b.z),
          maxZ: Math.max(a.z, b.z),
        },
        minX = cell(bounds.minX),
        maxX = cell(bounds.maxX),
        minZ = cell(bounds.minZ),
        maxZ = cell(bounds.maxZ);
      if ((maxX - minX + 1) * (maxZ - minZ + 1) > 4096) {
        longSegments.push(bounds);
        continue;
      }
      for (let x = minX; x <= maxX; x++)
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x},${z}`,
            list = cells.get(key) ?? [];
          list.push(bounds);
          cells.set(key, list);
        }
    }
  }
  return (bounds: Bounds, margin: number) => {
    const seen = new Set<Bounds>(),
      minX = cell(bounds.minX - margin),
      maxX = cell(bounds.maxX + margin),
      minZ = cell(bounds.minZ - margin),
      maxZ = cell(bounds.maxZ + margin);
    // Огромный контур оставляем целиком, вместо обхода миллионов клеток индекса.
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 4096) return true;
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++)
        for (const segment of cells.get(`${x},${z}`) ?? []) {
          if (seen.has(segment)) continue;
          seen.add(segment);
          if (overlap(segment, bounds, margin)) return true;
        }
    return longSegments.some((segment) => overlap(segment, bounds, margin));
  };
}

export function reduceMapElements(
  elements: OSMElement[],
  center: Center,
  mode: MapDetailMode = 'standard',
  closeCourtyards = false,
) {
  const byKey = new Map(elements.map((element) => [keyOf(element), element])),
    nodeById = new Map(
      elements
        .filter((element) => element.type === 'node')
        .map((node) => [node.id, node]),
    ),
    pointCache = new Map<number, { x: number; z: number }>(),
    point = (id: number) => {
      const cached = pointCache.get(id);
      if (cached) return cached;
      const node = nodeById.get(id);
      if (node?.lat === undefined || node.lon === undefined) return undefined;
      const local = toLocal(node.lat, node.lon, center);
      const value = { x: local.x, z: local.z };
      pointCache.set(id, value);
      return value;
    },
    roads = elements.filter(element => isRoad(element) && (!closeCourtyards || !isCourtyardRoad(element))),
    streets = roads.filter((road) => road.tags?.highway !== 'service');

  // В клетке только с внутриквартальными дорогами используем их как ориентир.
  const frontageRoads = streets.length ? streets : roads;
  if (!frontageRoads.length && mode === 'standard' && !closeCourtyards)
    return {
      elements,
      stats: { raw: summarize(elements), kept: summarize(elements) },
    };

  const nearStreet = streetIndex(frontageRoads, point),
    boundsCache = new Map<number, Bounds | undefined>(),
    wayBounds = (way: OSMElement) => {
      if (boundsCache.has(way.id)) return boundsCache.get(way.id);
      let bounds: Bounds | undefined;
      for (const id of way.nodes ?? []) {
        const location = point(id);
        if (!location) continue;
        if (!bounds)
          bounds = {
            minX: location.x,
            maxX: location.x,
            minZ: location.z,
            maxZ: location.z,
          };
        else {
          bounds.minX = Math.min(bounds.minX, location.x);
          bounds.maxX = Math.max(bounds.maxX, location.x);
          bounds.minZ = Math.min(bounds.minZ, location.z);
          bounds.maxZ = Math.max(bounds.maxZ, location.z);
        }
      }
      boundsCache.set(way.id, bounds);
      return bounds;
    },
    featureNearStreet = (element: OSMElement, margin: number) => {
      const ways =
        element.type === 'way'
          ? [element]
          : (element.members ?? [])
              .filter(
                (member) => member.type === 'way' && member.role !== 'inner',
              )
              .map((member) => byKey.get(`way/${member.ref}`))
              .filter((way) => way !== undefined);
      return ways.some((way) => {
        const bounds = wayBounds(way);
        return bounds && nearStreet(bounds, margin);
      });
    },
    kept = new Set<string>(),
    retain = (element: OSMElement | undefined) => {
      if (!element || kept.has(keyOf(element))) return;
      kept.add(keyOf(element));
      for (const id of element.nodes ?? []) retain(byKey.get(`node/${id}`));
      for (const member of element.members ?? [])
        retain(byKey.get(`${member.type}/${member.ref}`));
    };

  for (const element of elements) {
    const tags = element.tags ?? {};
    if (
      (isRoad(element) && (!closeCourtyards || !isCourtyardRoad(element))) ||
      (element.type === 'relation' && tags.type === 'restriction' &&
        (!closeCourtyards || !(element.members ?? []).some(member =>
          member.type === 'way' && isCourtyardRoad(byKey.get(`way/${member.ref}`) ?? element))))
    ) {
      retain(element);
    } else if (
      (tags.building && tags.building !== 'no') ||
      isBuildingPart(tags) ||
      tags.type === 'building'
    ) {
      if (
        tags.building === 'wall' ||
        (mode !== 'roads' &&
          (tags.name ||
            tags['name:ru'] ||
            tags.historic ||
            featureNearStreet(
              element,
              mode === 'minimal' ? 12 : FRONTAGE_METERS,
            )))
      )
        retain(element);
    } else if (isArea(element)) {
      if (
        mode === 'standard' &&
        (!isCourtyardGround(element) ||
          tags.name ||
          tags['name:ru'] ||
          featureNearStreet(element, FRONTAGE_METERS))
      )
        retain(element);
      else if (
        mode === 'minimal' &&
        (tags.natural === 'water' ||
          tags.waterway === 'riverbank' ||
          tags.landuse === 'reservoir' ||
          tags.leisure === 'park')
      )
        retain(element);
    } else if (element.type === 'node' && tags.highway === 'traffic_signals') {
      retain(element);
    } else if (element.type === 'node' && tags.natural === 'tree') {
      const location = point(element.id);
      if (
        mode === 'standard' &&
        (tags.name ||
          (location &&
            nearStreet(
              {
                minX: location.x,
                maxX: location.x,
                minZ: location.z,
                maxZ: location.z,
              },
              STREET_TREE_METERS,
            )))
      )
        retain(element);
    }
  }

  if (mode !== 'roads') {
    const { groups } = buildingGroups(elements, center);
    for (const [group, members] of groups) {
      // Вся явно описанная группа или значимая оболочка с её частями.
      if (kept.has(group) || [...members].some((key) => kept.has(key)))
        for (const key of members) retain(byKey.get(key));
    }
  }

  const reduced = elements.filter((element) => kept.has(keyOf(element)));
  return {
    elements: reduced,
    stats: { raw: summarize(elements), kept: summarize(reduced) },
  };
}
