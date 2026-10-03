import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import type { OSMElement, Tags } from './types';

function scene(tags: Tags, closed = true) {
  const elements: OSMElement[] = [
    ...[
      [30, 30],
      [50, 30],
      [50, 100],
      [30, 100],
    ].map(([x, z], i) => ({
      type: 'node' as const,
      id: i + 1,
      lat: z / 111320,
      lon: x / 111320,
    })),
    { type: 'way', id: 40, nodes: closed ? [1, 2, 3, 4, 1] : [1, 2, 3], tags },
  ];
  return buildWorld(
    {
      center: { lat: 0, lon: 0 },
      elements,
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      fetchedAt: 'test',
    },
    false,
  );
}

it.each(['#ff0000', '#ff1111', 'firebrick', '#00ff00'])(
  'приглушает чрезмерно насыщенный фасад %s',
  (colour) => {
    // Arrange
    const world = scene({ building: 'yes', 'building:colour': colour });
    // Act
    const colors = buildChunk(world, '0,0', 0).facades!.flatMap(
      (m) => m.colors!,
    );
    const rgb = colors.slice(0, 3);
    // Assert
    expect(rgb.length).toBe(3);
    expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThan(0.4);
    expect(Math.min(...rgb)).toBeGreaterThan(0.2);
  },
);

it.each([false, true])(
  'создаёт платформу только по замкнутому наземному контуру: %s',
  (closed) => {
    // Arrange
    const world = scene(
      { railway: 'platform', train: 'yes', area: 'yes' },
      closed,
    );
    // Act
    const platforms = world.areas.filter((a) => a.kind === 'platform');
    const mesh = buildChunk(world, '0,0', 0).structures;
    // Assert
    expect(platforms.length).toBe(closed ? 1 : 0);
    if (closed) expect(mesh.indices.length).toBeGreaterThan(0);
  },
);

it.each<Tags>([
  { location: 'underground' },
  { subway: 'yes' },
  { tunnel: 'yes' },
])('не поднимает подземную платформу на поверхность: %j', (extra) => {
  // Arrange
  const world = scene({ railway: 'platform', ...extra });
  // Act
  const platforms = world.areas.filter((a) => a.kind === 'platform');
  // Assert
  expect(platforms).toEqual([]);
});

it.each<Tags>([
  { building: 'roof', layer: '1' },
  { building: 'roof', layer: '7', 'building:levels': '0' },
  { 'building:part': 'roof' },
  { building: 'roof', height: 'неизвестно', min_height: 'нет' },
])('не назначает открытой крыше случайные этажи: %j', (tags) => {
  // Arrange
  const world = scene(tags);
  // Act
  const roof = world.buildings[0];
  // Assert
  expect(roof.height).toBe(roof.floorHeight);
  expect(roof.minHeight).toBe(roof.height);
  expect(roof.technicalHeight).toBe(0);
});

it.each<Tags>([
  { height: '8', min_height: '7' },
  { min_height: '9' },
  { min_height: '7', 'roof:shape': 'gabled', 'roof:height': '2' },
])('сохраняет размеры открытой крыши из OSM: %j', (tags) => {
  // Arrange
  const world = scene({ building: 'roof', ...tags });
  // Act
  const roof = world.buildings[0];
  // Assert
  expect(roof.height).toBe(tags.height ? 8 : 9);
  expect(roof.minHeight).toBe(tags.min_height === '7' ? 7 : 9);
});

it.each([0, 1, 2])(
  'оставляет пространство под открытой крышей на LOD %s',
  (lod) => {
    // Arrange
    const world = scene({ building: 'roof', height: '8', min_height: '7' });
    // Act
    const chunk = buildChunk(world, '0,0', lod);
    // Assert
    expect(chunk.facades!.flatMap((m) => m.indices)).toEqual([]);
    expect(chunk.bareFacades!.flatMap((m) => m.indices)).toEqual([]);
    expect(chunk.buildings.indices.length).toBeGreaterThan(0);
    expect(
      chunk.buildings.positions
        .filter((_, i) => i % 3 === 1)
        .every((y) => y === 8),
    ).toBe(true);
  },
);

it('сохраняет фасадные стены обычного здания', () => {
  // Arrange
  const world = scene({ building: 'yes', height: '8' });
  // Act
  const chunk = buildChunk(world, '0,0', 0);
  // Assert
  expect(chunk.facades!.some((m) => m.indices.length > 0)).toBe(true);
});

it.each([0, 1, 2])(
  'сохраняет скаты открытой крыши без вертикальных стен на LOD %s',
  (lod) => {
    // Arrange
    const world = scene({
      building: 'roof',
      height: '9',
      min_height: '7',
      'roof:shape': 'gabled',
      'roof:height': '2',
    });
    // Act
    const mesh = buildChunk(world, '0,0', lod).buildings;
    const ys = mesh.positions.filter((_, i) => i % 3 === 1);
    // Assert
    expect(Math.min(...ys)).toBe(7);
    expect(Math.max(...ys)).toBe(9);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices
        .slice(i, i + 3)
        .map((j) => ({
          x: mesh.positions[j * 3],
          z: mesh.positions[j * 3 + 2],
        }));
      expect(
        Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)),
      ).toBeGreaterThan(0);
    }
  },
);
