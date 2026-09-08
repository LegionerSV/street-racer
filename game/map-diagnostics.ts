import { distance2, projectOnSegment, sampleRoadElevation, toGeo } from './geo';
import { MAP_BUILD_VERSION } from './map-version';
import type { Point, World } from './types';

// Полный снимок только по запросу экспорта, а не в игровом цикле.
export function mapDiagnostics(world: World, position: Point) {
  const nearest = world.edges
    .map((edge) => {
      let distance = Infinity;
      for (let i = 1; i < edge.points.length; i++)
        distance = Math.min(
          distance,
          projectOnSegment(position, edge.points[i - 1], edge.points[i])
            .distance,
        );
      return { edge, distance };
    })
    .filter((e) => e.distance <= 600)
    .sort((a, b) => a.distance - b.distance);
  const selected = [
    ...new Map(
      [
        ...nearest.slice(0, 16),
        ...nearest.filter((e) => e.edge.blocked).slice(0, 16),
      ].map((e) => [e.edge.id, e]),
    ).values(),
  ];
  return {
    version: MAP_BUILD_VERSION,
    coordinates: toGeo(position, world.center),
    heightDatum: world.heightDatum,
    loadedTiles: world.loadedTiles,
    warnings: world.warnings,
    blockedCounts: {
      coverage: world.edges.filter((e) =>
        e.blockedReasons?.includes('coverage'),
      ).length,
      grade: world.edges.filter((e) => e.blockedReasons?.includes('grade'))
        .length,
      clearance: world.edges.filter((e) =>
        e.blockedReasons?.includes('clearance'),
      ).length,
    },
    elevationPatches: (world.elevation.patches || [world.elevation]).map(
      (g) => ({
        width: g.width,
        size: g.size,
        offsetX: g.offsetX,
        offsetZ: g.offsetZ,
      }),
    ),
    roads: selected.map(({ edge: e, distance }) => ({
      way: e.way,
      from: e.from,
      to: e.to,
      name: e.name,
      distance,
      bridge: e.bridge,
      tunnel: e.tunnel,
      layer: e.layer,
      blocked: e.blocked,
      blockedReasons: e.blockedReasons,
      clearanceIssue: e.clearanceIssue,
      sourceHeightRange: e.sourceHeightRange,
      maxGrade: e.points
        .slice(1)
        .reduce(
          (n, p, i) =>
            Math.max(
              n,
              Math.abs(p.y - e.points[i].y) / (distance2(p, e.points[i]) || 1),
            ),
          0,
        ),
      points: e.points.map((p) => ({
        ...p,
        terrainY: sampleRoadElevation(world.elevation, p.x, p.z),
      })),
    })),
  };
}
