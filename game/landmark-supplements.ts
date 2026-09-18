import { distance2, toLocal } from './geo';
import type { Building, Center, Point } from './types';

const PETER_AND_PAUL_GROUP = 'relation/2594681';
const PETER_AND_PAUL_TOWER = { lat: 59.950105, lon: 30.316005 };

function rectangle(center: Point, width: number, depth: number, heading: number) {
  const forward = { x: Math.sin(heading), z: Math.cos(heading) };
  const side = { x: Math.cos(heading), z: -Math.sin(heading) };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([across, along]) => ({
    x: center.x + (side.x * across * width) / 2 + (forward.x * along * depth) / 2,
    y: center.y,
    z: center.z + (side.z * across * width) / 2 + (forward.z * along * depth) / 2,
  }));
}

export function addLandmarkSupplements(buildings: Building[], center: Center) {
  const cathedral = buildings.find(
    (building) => building.osmTags?.wikidata === 'Q736587',
  );
  if (!cathedral) return;
  cathedral.height = 32;
  cathedral.levels = 2;
  cathedral.floorHeight = 4.2;
  cathedral.facadeColour = '#e2cf91';
  cathedral.windowPolicy = 'procedural';
  cathedral.group = PETER_AND_PAUL_GROUP;
  const anchor = toLocal(
    PETER_AND_PAUL_TOWER.lat,
    PETER_AND_PAUL_TOWER.lon,
    center,
  );
  anchor.y = Math.min(...cathedral.footprint.map((point) => point.y));
  const alreadyDetailed = buildings.some((building) => {
    if (building === cathedral || building.height < 100) return false;
    const centroid = building.footprint.reduce(
      (point, current) => ({
        x: point.x + current.x / building.footprint.length,
        y: point.y + current.y / building.footprint.length,
        z: point.z + current.z / building.footprint.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    return distance2(centroid, anchor) < 100;
  });
  if (alreadyDetailed) return;
  const common = {
    osmType: 'way' as const,
    sourceKey: `${cathedral.osmType ?? 'way'}/${cathedral.id}`,
    part: true,
    group: PETER_AND_PAUL_GROUP,
    colour: 0.52,
    material: 'stone',
    facadeColour: '#e2cf91',
    technicalHeight: 0,
  };
  buildings.push(
    {
      ...common,
      id: -259468101,
      footprint: rectangle(anchor, 12, 14, 0.9),
      height: 56,
      minHeight: 0,
      roof: 'flat',
      levels: 10,
      floorHeight: 5.6,
      windowPolicy: 'procedural',
    },
    {
      ...common,
      id: -259468102,
      footprint: rectangle(anchor, 8.5, 8.5, 0.9),
      height: 70,
      minHeight: 56,
      roof: 'pyramidal',
      roofHeight: 8,
      roofColour: 'gold',
      levels: 2,
      floorHeight: 3,
      windowPolicy: 'forbid',
    },
    {
      ...common,
      id: -259468103,
      footprint: rectangle(anchor, 5.2, 5.2, 0.9),
      height: 122.5,
      minHeight: 70,
      roof: 'cone',
      roofHeight: 52.5,
      roofMaterial: 'gold',
      roofColour: 'gold',
      levels: 1,
      floorHeight: 3,
      windowPolicy: 'forbid',
    },
  );
}
