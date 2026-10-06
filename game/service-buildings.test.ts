import { expect, it } from 'vitest';
import fixture from './fixtures/pushkin-service-buildings.osm.json';
import { buildWorld } from './network';
import { appendBuilding, hasFacadeWindows } from './buildings';
import type { MeshData, OSMElement, Tags } from './types';

function world(elements: OSMElement[]) {
  return buildWorld(
    {
      center: { lat: 59.70303725107046, lon: 30.3762842478244 },
      elements,
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      fetchedAt: fixture.osmTimestamp,
    },
    false,
  );
}

function service(tags: Tags = {}, id = 169491168) {
  const elements = fixture.elements as OSMElement[];
  return world(
    elements
      .filter((e) => e.type === 'node')
      .concat({
        ...elements.find((e) => e.type === 'way' && e.id === 169491168)!,
        id,
        tags: { building: 'service', ...tags },
      }),
  ).buildings[0];
}

it('воспроизводит три служебных здания из опубликованных тайлов без случайной этажности', () => {
  // Arrange
  const elements = fixture.elements as OSMElement[];
  // Act
  const buildings = world(elements).buildings;
  // Assert
  for (const id of [169491167, 169491168, 1068231883]) {
    const building = buildings.find((b) => b.id === id)!;
    expect(building).toMatchObject({ height: 3.8, levels: 1, kind: 'service' });
    expect(building.osmTags?.height).toBeUndefined();
    expect(building.osmTags?.['building:levels']).toBeUndefined();
    expect(hasFacadeWindows(building)).toBe(false);
  }
});

it.each<{ name: string; tags: Tags; height: number; levels: number }>([
  { name: 'нет размеров', tags: {}, height: 3.8, levels: 1 },
  { name: 'только высота', tags: { height: '12' }, height: 12, levels: 4 },
  {
    name: 'только этажность',
    tags: { 'building:levels': '3' },
    height: 9.8,
    levels: 3,
  },
  {
    name: 'оба размера',
    tags: { height: '7', 'building:levels': '2' },
    height: 7,
    levels: 2,
  },
  {
    name: 'ошибочные размеры',
    tags: { height: 'unknown', 'building:levels': '?' },
    height: 3.8,
    levels: 1,
  },
  {
    name: 'нулевая этажность',
    tags: { 'building:levels': '0' },
    height: 0.1,
    levels: 0,
  },
])('служебное здание: $name', ({ tags, height, levels }) => {
  // Arrange / Act
  const building = service(tags);
  // Assert
  expect(building.height).toBeCloseTo(height);
  expect(building.levels).toBe(levels);
});

it('не связывает fallback служебных зданий с OSM id и сохраняет соседние типы', () => {
  // Arrange / Act
  const buildings = [1, 77, 123456789].map((id) => service({}, id));
  const apartments = service({
    building: 'apartments',
    'building:levels': '5',
  });
  const tower = service({ building: 'transformer_tower', height: '18' });
  // Assert
  expect(buildings.map((b) => b.height)).toEqual([3.8, 3.8, 3.8]);
  expect(apartments.height).toBe(15.8);
  expect(hasFacadeWindows(apartments)).toBe(true);
  expect(tower.height).toBe(18);
});

it.each([0, 1, 2])(
  'не генерирует жилой фасад будке в LOD %s и уважает явные окна',
  (lod) => {
    // Arrange
    const mesh = (): MeshData => ({
      positions: [],
      indices: [],
      colors: [],
      uvs: [],
    });
    const shell = mesh(),
      facades = Array.from({ length: 4 }, mesh),
      bare = Array.from({ length: 4 }, mesh);
    const building = service();
    // Act
    appendBuilding(
      building,
      lod,
      shell,
      facades,
      [],
      undefined,
      undefined,
      bare,
    );
    // Assert
    expect(facades.every((m) => m.indices.length === 0)).toBe(true);
    expect(bare.some((m) => m.indices.length > 0)).toBe(true);
    expect(hasFacadeWindows(service({ windows: 'yes' }))).toBe(true);
    expect(hasFacadeWindows(service({ windows: 'no', window: 'yes' }))).toBe(
      false,
    );
  },
);

it('перестраивает размеры при появлении явных данных после fallback', () => {
  // Arrange
  const before = service();
  // Act
  const after = service({ height: '4.6', 'building:levels': '1' });
  // Assert
  expect(before.height).toBe(3.8);
  expect(after.height).toBe(4.6);
  expect(after.osmTags?.height).toBe('4.6');
});

it('сохраняет данные храма без выдуманной башни и купола', () => {
  // Arrange
  const elements = fixture.elements as OSMElement[];
  const church = elements.find((e) => e.type === 'way' && e.id === 46517346)!;
  // Act
  const building = world(elements).buildings.find((b) => b.id === church.id)!;
  // Assert
  expect(building.levels).toBe(2);
  expect(building.roof).toBe('flat');
  expect(building.osmTags).toEqual(church.tags);
  expect(building.osmTags?.['roof:shape']).toBeUndefined();
  expect(elements.filter((e) => e.tags?.['building:part'])).toHaveLength(1);
});

it('не превращает магазин на Красносельском шоссе в случайную пятиэтажку', () => {
  // Arrange
  const elements = fixture.elements as OSMElement[];
  // Act
  const store = world(elements).buildings.find((b) => b.id === 144896173)!;
  // Assert
  expect(store).toMatchObject({ height: 5, levels: 1, kind: 'retail' });
  expect(store.osmTags?.height).toBeUndefined();
  expect(store.osmTags?.['building:levels']).toBeUndefined();
});

it.each(['retail', 'kiosk'])(
  'использует низкий fallback для %s и сохраняет явные размеры',
  (kind) => {
    // Arrange / Act
    const unknown = service({ building: kind }, 12);
    const mapped = service({
      building: kind,
      height: '15',
      'building:levels': '3',
    });
    // Assert
    expect(unknown.levels).toBe(1);
    expect(mapped.height).toBe(15);
    expect(mapped.levels).toBe(3);
  },
);
