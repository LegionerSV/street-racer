import { boundsOf, SpatialGrid } from './geometry';
import type { Building } from './types';

const HOUSE_KINDS = new Set([
  'yes',
  'house',
  'detached',
  'semi_detached',
  'semidetached_house',
  'bungalow',
  'cabin',
  'farm',
]);
const NEIGHBORHOOD_METERS = 180;

function footprintArea(building: Building) {
  const points = building.footprint;
  return (
    Math.abs(
      points.reduce(
        (sum, p, i) =>
          sum +
          p.x * points[(i + 1) % points.length].z -
          points[(i + 1) % points.length].x * p.z,
        0,
      ),
    ) / 2
  );
}

function compactHome(building: Building) {
  const tags = building.osmTags || {};
  return (
    !building.part &&
    !building.group &&
    !building.holes?.length &&
    (building.minHeight || 0) < 0.3 &&
    HOUSE_KINDS.has(building.kind || '') &&
    building.height <= 9 &&
    footprintArea(building) >= 55 &&
    footprintArea(building) <= 350 &&
    ![
      'shop',
      'amenity',
      'tourism',
      'office',
      'craft',
      'industrial',
      'historic',
      'religion',
      'man_made',
      'public_transport',
      'leisure',
      'healthcare',
    ].some((key) => tags[key])
  );
}

export function applyBuildingAppearances(buildings: Building[]) {
  const index = new SpatialGrid<Building>(NEIGHBORHOOD_METERS);
  const centers = new Map<Building, { x: number; z: number }>();
  for (const building of buildings) {
    if (building.part) continue;
    const bounds = boundsOf(building.footprint);
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };
    centers.set(building, center);
    index.add(building, {
      minX: center.x,
      maxX: center.x,
      minZ: center.z,
      maxZ: center.z,
    });
  }
  for (const building of buildings) {
    if (!compactHome(building)) continue;
    const center = centers.get(building)!;
    const nearby = index
      .query({
        minX: center.x - NEIGHBORHOOD_METERS,
        maxX: center.x + NEIGHBORHOOD_METERS,
        minZ: center.z - NEIGHBORHOOD_METERS,
        maxZ: center.z + NEIGHBORHOOD_METERS,
      })
      .filter((other) => {
        const p = centers.get(other)!;
        return (
          Math.hypot(p.x - center.x, p.z - center.z) <= NEIGHBORHOOD_METERS
        );
      });
    if (
      nearby.length < 4 ||
      nearby.length > 24 ||
      nearby.filter(compactHome).length / nearby.length < 0.6
    )
      continue;
    building.appearance = 'cottage';
    if (!building.osmTags?.['roof:shape']) building.roof = 'gabled';
    if (
      !building.osmTags?.height &&
      !building.osmTags?.['building:levels'] &&
      !building.osmTags?.['roof:height'] &&
      !building.osmTags?.['roof:levels']
    ) {
      const bounds = boundsOf(building.footprint),
        roofHeight = Math.min(
          1.5,
          Math.max(
            0.3,
            Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2,
          ),
        );
      building.height = 3 + roofHeight;
      building.levels = 1;
      building.floorHeight = 3;
      building.roofHeight = roofHeight;
      building.technicalHeight = 0;
    }
  }
}
