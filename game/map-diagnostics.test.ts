import { expect, it } from 'vitest';
import { mapDiagnostics } from './map-diagnostics';
import { MAP_BUILD_VERSION } from './map-version';
import { buildWorld } from './network';
import { validateClearance } from './clearance';
import type { Edge } from './types';

it('экспортирует причину заграждения, конфликтующую дорогу и высоты возле машины', () => {
  // Arrange — физически недостаточный просвет, без автоматического исправления.
  const make = (id: number, bridge: boolean): Edge => ({
    id,
    stableId: `${100 + id}/${id * 2}/${id * 2 + 1}/0`,
    way: 100 + id,
    from: id * 2,
    to: id * 2 + 1,
    length: 200,
    width: 12,
    lanes: 2,
    speed: 10,
    name: bridge ? 'Мост' : 'Набережная',
    bridge,
    tunnel: false,
    layer: bridge ? 1 : 0,
    blocked: false,
    sourceHeightRange: [12, 14],
    points: bridge
      ? [
          { x: -100, y: 1, z: 0 },
          { x: 100, y: 1, z: 0 },
        ]
      : [
          { x: 0, y: 0, z: -100 },
          { x: 0, y: 0, z: 100 },
        ],
  });
  const world = buildWorld({
    center: { lat: 0, lon: 0 },
    elements: [],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  world.edges = [make(0, true), make(1, false)];
  // Act
  validateClearance(world.edges);
  const report = JSON.parse(
    JSON.stringify(mapDiagnostics(world, { x: 0, y: 2, z: 0 })),
  );
  // Assert
  expect(report.version).toBe(MAP_BUILD_VERSION);
  expect(report.roads[0].blockedReasons).toEqual(['clearance']);
  expect(report.roads[0].clearanceIssue).toMatchObject({
    otherWay: 101,
    required: 3.5,
  });
  expect(report.roads[0].clearanceIssue.available).toBeCloseTo(0.45, 8);
  expect(report.roads[0].sourceHeightRange).toEqual([12, 14]);
  expect(report.roads[0].points[0]).toEqual({
    x: -100,
    y: 1,
    z: 0,
    terrainY: 0,
  });
  expect(report.blockedCounts).toEqual({ coverage: 0, grade: 0, clearance: 1 });
});
