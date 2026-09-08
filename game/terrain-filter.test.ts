import { expect, it } from 'vitest';
import { sampleRoadElevation, smoothElevation, toLocal } from './geo';
import admiral from './fixtures/admiral-elevation.json';
import birzhevaya from './fixtures/birzhevaya-elevation.json';
import roads from './fixtures/birzhevaya-roads.osm.json';
import admiralRoads from './fixtures/admiral-roads.osm.json';
import { ELEVATION_TILE_SIZE, ELEVATION_TILE_WIDTH } from './region-stream';

it('убирает широкие локальные пики DEM на Биржевой площади', () => {
  // Arrange — исходный DEM, а не измеренные отметки дороги.
  const grid = { ...birzhevaya, values: Float32Array.from(birzhevaya.values) };
  const ids = new Set(
    roads.elements
      .filter((e) => e.type === 'way' && e.tags?.name === 'Биржевая площадь')
      .flatMap((e) => e.nodes || []),
  );
  const points = roads.elements
    .filter((e) => e.type === 'node' && ids.has(e.id))
    .map((n) => toLocal(n.lat!, n.lon!, birzhevaya.center));
  // Act
  const filtered = smoothElevation(grid),
    heights = points.map((p) => sampleRoadElevation(filtered, p.x, p.z));
  // Assert — рельеф участка не должен превращаться в горки высотой 6–7 м.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2);
});
it('подавляет городской пик размером в квартал, сохраняя протяжённый склон', () => {
  // Arrange
  const width = 161,
    size = 3200;
  const values = Float32Array.from({ length: width * width }, (_, i) => {
    const x = ((i % width) - 80) * 20,
      z = (Math.floor(i / width) - 80) * 20;
    return x * 0.03 + (Math.abs(x) < 150 && Math.abs(z) < 150 ? 20 : 0);
  });
  // Act
  const grid = smoothElevation({ width, size, values });
  // Assert
  expect(Math.abs(sampleRoadElevation(grid, 0, 0))).toBeLessThan(0.5);
  expect(
    sampleRoadElevation(grid, 400, 0) - sampleRoadElevation(grid, -400, 0),
  ).toBeCloseTo(24, 1);
});
it('снижает перепад на Адмиралтейском проспекте в исходном DEM', () => {
  // Arrange
  const grid = { ...admiral, values: Float32Array.from(admiral.values) };
  // Act
  const filtered = smoothElevation(grid);
  const points = admiralRoads.elements
    .filter((n) => n.type === 'node')
    .map((n) => {
      const p = toLocal(n.lat!, n.lon!, admiral.center);
      return sampleRoadElevation(filtered, p.x, p.z);
    });
  // Assert
  expect(Math.max(...points) - Math.min(...points)).toBeLessThan(4);
});
it('сохраняет одинаковые высоты на стыке независимо очищенных клеток', () => {
  // Arrange — асимметричный рельеф и пики возле общей границы.
  const width = ELEVATION_TILE_WIDTH,
    size = ELEVATION_TILE_SIZE;
  const patch = (offsetX: number) => ({
    width,
    size,
    offsetX,
    offsetZ: 500,
    values: Float32Array.from({ length: width * width }, (_, i) => {
      const x = offsetX - size / 2 + (i % width) * 20,
        z = 500 - size / 2 + Math.floor(i / width) * 20;
      return (
        x * 0.01 +
        Math.sin(z / 230) * 5 +
        (Math.abs(x - 1020) < 170 && Math.abs(z - 450) < 130 ? 25 : 0)
      );
    }),
  });
  // Act
  const left = smoothElevation(patch(500)),
    right = smoothElevation(patch(1500));
  // Assert
  for (let z = 0; z <= 1000; z += 25)
    expect(sampleRoadElevation(left, 1000, z)).toBeCloseTo(
      sampleRoadElevation(right, 1000, z),
      4,
    );
});
