import { expect, it } from 'vitest';
import fixture from './fixtures/pushkin-service-buildings.osm.json';
import { buildWorld } from './network';
import { reduceMapElements } from './map-element-filter';
import { mapCellQuery } from './map-source';
import type { OSMElement, Tags } from './types';

const center = { lat: 59.7076, lon: 30.3812 };
const source = fixture.elements as OSMElement[];
const original = source.find((e) => e.type === 'way' && e.id === 1373131580)!;
function elements(tags: Tags = {}, closed = true) {
  return source
    .filter((e) => e.type === 'node')
    .concat({
      ...original,
      nodes: closed ? original.nodes : original.nodes!.slice(0, -1),
      tags: {
        man_made: 'tower',
        'tower:type': 'bell_tower',
        'building:levels': '3',
        ...tags,
      },
    });
}
function build(input: OSMElement[]) {
  return buildWorld(
    {
      center,
      elements: input,
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      fetchedAt: fixture.osmTimestamp,
    },
    false,
  );
}

it('строит колокольню по исходному OSM без building=yes и без выдуманного купола', () => {
  // Arrange
  const input = elements();
  // Act
  const tower = build(input).buildings[0];
  // Assert
  expect(tower).toMatchObject({
    id: original.id,
    kind: 'bell_tower',
    levels: 3,
    height: 9.8,
    roof: 'flat',
    windowPolicy: 'forbid',
  });
  expect(tower.osmTags).toEqual(original.tags);
});

it.each(['standard', 'minimal', 'roads'] as const)(
  'сохраняет колокольню и её узлы в режиме %s',
  (mode) => {
    // Arrange
    const input = elements();
    // Act
    const reduced = reduceMapElements(input, center, mode);
    // Assert
    expect(
      reduced.elements.some((e) => e.type === 'way' && e.id === original.id),
    ).toBe(true);
    const nodes = new Set(
      reduced.elements.filter((e) => e.type === 'node').map((e) => e.id),
    );
    expect(original.nodes!.every((id) => nodes.has(id))).toBe(true);
    expect(reduced.stats.kept.buildings).toBe(1);
  },
);

it.each<Tags>([
  { man_made: 'mast' },
  { building: 'no' },
  { location: 'underground' },
])('не превращает неподходящие объекты в колокольню: %j', (tags) => {
  // Arrange
  const input = elements(tags);
  // Act
  const result = build(input);
  // Assert
  expect(result.buildings).toHaveLength(0);
});

it('не создаёт объём по незамкнутой линии', () => {
  // Arrange
  const input = elements({}, false);
  // Act
  const result = build(input);
  // Assert
  expect(result.buildings).toHaveLength(0);
});

it('сохраняет явно заданные размеры, крышу и окна колокольни', () => {
  // Arrange
  const input = elements({
    height: '18',
    min_height: '4',
    'roof:shape': 'onion',
    'roof:height': '5',
    windows: 'yes',
  });
  // Act
  const tower = build(input).buildings[0];
  // Assert
  expect(tower).toMatchObject({
    height: 18,
    minHeight: 4,
    roof: 'onion',
    roofHeight: 5,
    windowPolicy: 'procedural',
  });
});

it('добавляет колокольни в запрос исходных OSM', () => {
  // Arrange
  const bounds = { south: 59.707, west: 30.38, north: 59.708, east: 30.382 };
  // Act
  const query = mapCellQuery(bounds);
  // Assert
  expect(query).toContain('nwr["man_made"~"^(tower|water_tower)$"]');
});

it('сохраняет башню multipolygon и её геометрию после фильтрации', () => {
  // Arrange
  const input = elements().map((e) =>
    e.type === 'way' ? { ...e, tags: {} } : e,
  );
  input.push({
    type: 'relation',
    id: 77,
    members: [{ type: 'way', ref: original.id, role: 'outer' }],
    tags: { type: 'multipolygon', man_made: 'water_tower', height: '24' },
  });
  // Act
  const reduced = reduceMapElements(input, center, 'roads');
  const tower = build(reduced.elements).buildings[0];
  // Assert
  expect(tower).toMatchObject({ id: 77, kind: 'water_tower', height: 24 });
  expect(tower.footprint).toEqual(build(elements()).buildings[0].footprint);
});

it.each(['defensive', 'watchtower', 'communication'])(
  'строит размеченный замкнутый контур башни %s',
  (type) => {
    // Arrange
    const input = elements({ 'tower:type': type });
    // Act
    const tower = build(input).buildings[0];
    // Assert
    expect(tower).toMatchObject({
      kind: type,
      levels: 3,
      height: 9.8,
      windowPolicy: 'forbid',
    });
  },
);

it('сохраняет явную высоту водонапорной башни и не придумывает контур для точки', () => {
  // Arrange
  const mapped = elements({ man_made: 'water_tower', height: '30 m' });
  const point: OSMElement = {
    type: 'node',
    id: 99,
    lat: center.lat,
    lon: center.lon,
    tags: { man_made: 'tower', height: '30' },
  };
  // Act
  const tower = build(mapped).buildings[0];
  const pointWorld = build([point]);
  // Assert
  expect(tower).toMatchObject({ kind: 'bell_tower', height: 30 });
  expect(pointWorld.buildings).toHaveLength(0);
});
