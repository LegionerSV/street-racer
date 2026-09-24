import { expect, it } from 'vitest';
import { buildingGroups, resolveBuildingEnvelopes } from './building-groups';
import { reduceMapElements } from './map-element-filter';
import { buildWorld } from './network';
import type { Building, OSMElement } from './types';
import fortress from './fixtures/fortress-roofs.osm.json';
const center = { lat: 0, lon: 0 };

it('сохраняет оболочку под полностью совпадающей неразмеченной крышей', () => {
  // Arrange
  const elements = [
    ...square(1, 0, 0, 100, { building: 'cathedral', height: '12' }),
    ...square(2, 0, 0, 100, { 'building:part': 'roof' }),
  ];
  // Act
  const world = buildWorld({
    center,
    elements,
    drivingSide: 'right',
    fetchedAt: 'test',
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  });
  // Assert
  expect(world.buildings.map((b) => b.id)).toEqual([1]);
  expect(world.buildings[0].height).toBe(12);
});

it.each([false, true])(
  'не создаёт случайную крышу поверх размеченных частей, явная высота: %s',
  (explicit) => {
    // Arrange
    const elements = [
      ...square(1, 0, 0, 100, { building: 'cathedral', height: '12' }),
      ...square(2, 20, 20, 10, { 'building:part': 'yes', height: '18' }),
      ...square(3, 20, 20, 10, {
        'building:part': 'roof',
        ...(explicit ? { height: '20', min_height: '18' } : {}),
      }),
    ];
    // Act
    const world = buildWorld({
      center,
      elements,
      drivingSide: 'right',
      fetchedAt: 'test',
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    });
    // Assert
    expect(world.buildings.some((b) => b.id === 3)).toBe(explicit);
    expect(world.buildings.some((b) => b.id === 2)).toBe(true);
  },
);

it('не создаёт висящую пластину и дублирующие стены на реальных частях Петропавловского собора', () => {
  // Arrange / Act
  const world = buildWorld({
    center: fortress.center,
    elements: fortress.elements as OSMElement[],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  // Assert
  expect(
    world.buildings.filter((b) => [14293057, 14293059].includes(b.id)),
  ).toEqual([]);
  expect(world.buildings.find((b) => b.id === 3080925)?.height).toBe(18);
  expect(world.buildings.find((b) => b.id === 3080921)?.height).toBe(122.5);
});
function square(
  id: number,
  x: number,
  z: number,
  size: number,
  tags: Record<string, string>,
): OSMElement[] {
  return [
    ...[
      [x, z],
      [x + size, z],
      [x + size, z + size],
      [x, z + size],
    ].map(([x, z], i) => ({
      type: 'node' as const,
      id: id * 10 + i,
      lon: x / 111320,
      lat: z / 111320,
    })),
    {
      type: 'way',
      id,
      nodes: [id * 10, id * 10 + 1, id * 10 + 2, id * 10 + 3, id * 10],
      tags,
    },
  ];
}
it('сохраняет части значимого здания и зависимости, продолжая удалять обычные дворы', () => {
  // Arrange
  const elements: OSMElement[] = [
    ...square(1, 0, 100, 100, { building: 'cathedral', name: 'Собор' }),
    ...square(2, 40, 140, 10, { 'building:part': 'yes', height: '40' }),
    ...square(3, 200, 100, 100, { building: 'apartments' }),
    ...square(4, 240, 140, 10, { 'building:part': 'yes' }),
    { type: 'node', id: 1000, lon: 0, lat: 0 },
    { type: 'node', id: 1001, lon: 0.01, lat: 0 },
    {
      type: 'way',
      id: 1002,
      nodes: [1000, 1001],
      tags: { highway: 'residential' },
    },
  ];
  // Act
  const reduced = reduceMapElements(elements, center),
    keys = new Set(reduced.elements.map((e) => `${e.type}/${e.id}`));
  // Assert
  expect(keys.has('way/2')).toBe(true);
  expect(keys.has('node/20')).toBe(true);
  expect(keys.has('way/3')).toBe(false);
  expect(keys.has('way/4')).toBe(false);
  expect(keys.has('way/1002')).toBe(true);
  const roadKeys = new Set(
    reduceMapElements(elements, center, 'roads').elements.map(
      (e) => `${e.type}/${e.id}`,
    ),
  );
  expect(roadKeys.has('way/1')).toBe(true);
  expect(roadKeys.has('way/2')).toBe(true);
  expect(roadKeys.has('way/3')).toBe(false);
  expect(roadKeys.has('way/4')).toBe(false);
});
it('не объединяет две башни по имени или Wikidata и не присоединяет часть во дворе-отверстии', () => {
  // Arrange
  const elements: OSMElement[] = [
    ...square(1, 0, 0, 100, {}),
    ...square(2, 30, 30, 40, {}),
    ...square(3, 40, 40, 5, { 'building:part': 'yes' }),
    ...square(4, 5, 5, 5, { 'building:part': 'yes' }),
    ...square(5, 200, 0, 100, {
      building: 'tower',
      name: 'Башня',
      wikidata: 'Q1',
    }),
    ...square(6, 210, 10, 5, { 'building:part': 'yes' }),
    {
      type: 'relation',
      id: 1,
      tags: {
        type: 'multipolygon',
        building: 'tower',
        name: 'Башня',
        wikidata: 'Q1',
      },
      members: [
        { type: 'way', ref: 1, role: 'outer' },
        { type: 'way', ref: 2, role: 'inner' },
      ],
    },
  ];
  // Act
  const { groupOf } = buildingGroups(elements, center);
  // Assert
  expect(groupOf.has('way/3')).toBe(false);
  expect(groupOf.get('way/4')).toBe('relation/1');
  expect(groupOf.get('way/6')).toBe('way/5');
  expect(groupOf.has('way/1')).toBe(false);
});
it('явные отношения обходятся с циклами и отсутствующими участниками без смешения type/id', () => {
  // Arrange
  const elements: OSMElement[] = [
    ...square(1, 0, 0, 10, { building: 'church' }),
    ...square(2, 2, 2, 2, { 'building:part': 'yes' }),
    {
      type: 'relation',
      id: 1,
      tags: { type: 'building', building: 'church' },
      members: [
        { type: 'way', ref: 1, role: 'outline' },
        { type: 'way', ref: 2, role: 'part' },
        { type: 'relation', ref: 1, role: 'part' },
        { type: 'way', ref: 999, role: 'part' },
      ],
    },
  ];
  // Act
  const { groupOf, groupTags } = buildingGroups(elements, center);
  // Assert
  expect(groupOf.get('way/1')).toBe('relation/1');
  expect(groupOf.get('way/2')).toBe('relation/1');
  expect(groupOf.has('way/999')).toBe(false);
  expect(groupTags.get('relation/1')).toMatchObject({ building: 'church' });
  expect(reduceMapElements(elements, center).elements.length).toBe(
    elements.length,
  );
});
it('поднимает roof-face без min_height к высоте кровли или опорного яруса', () => {
  // Arrange
  const footprint = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 10, y: 0, z: 10 },
    { x: 0, y: 0, z: 10 },
  ];
  const part = (
    id: number,
    height: number,
    tags: Record<string, string>,
  ): Building => ({
    id,
    footprint,
    height,
    part: true,
    colour: 0.5,
    roof: 'flat',
    group: 'relation/1',
    osmTags: tags,
  });
  const fromRoofHeight = part(1, 31.8, { 'building:part': 'roof' });
  fromRoofHeight.roofHeight = 1.8;
  const fromSupport = part(2, 24, { 'building:part': 'roof' });
  const support = part(3, 20, { 'building:part': 'yes' });
  const fallback = part(4, 12, { 'building:part': 'roof' });
  const explicit = {
    ...part(5, 30, { 'building:part': 'roof', min_height: '26' }),
    minHeight: 26,
  };
  // Act
  resolveBuildingEnvelopes([
    fromRoofHeight,
    fromSupport,
    support,
    fallback,
    explicit,
  ]);
  // Assert
  expect(fromRoofHeight.minHeight).toBeCloseTo(30, 6);
  expect(fromSupport.minHeight).toBe(20);
  expect(fallback.minHeight).toBeCloseTo(11.9, 6);
  expect(explicit.minHeight).toBe(26);
});
it('нормализует roof-face с roof:height и без строительной группы', () => {
  // Arrange
  const roof: Building = {
    id: 1,
    footprint: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
      { x: 0, y: 0, z: 10 },
    ],
    height: 12,
    part: true,
    colour: 0.5,
    roof: 'flat',
    roofHeight: 2,
    osmTags: { 'building:part': 'roof' },
  };
  // Act
  resolveBuildingEnvelopes([roof]);
  // Assert
  expect(roof.minHeight).toBe(10);
});
it('вложенная группа и её части принадлежат одной компоненте независимо от порядка OSM', () => {
  // Arrange
  const elements: OSMElement[] = [
    ...square(5, 0, 0, 10, { building: 'church' }),
    ...square(6, 1, 1, 2, { 'building:part': 'yes' }),
    {
      type: 'relation',
      id: 1,
      tags: { type: 'building' },
      members: [
        { type: 'way', ref: 5, role: 'outline' },
        { type: 'relation', ref: 2, role: 'part' },
      ],
    },
    {
      type: 'relation',
      id: 2,
      tags: { type: 'building' },
      members: [
        { type: 'way', ref: 6, role: 'part' },
        { type: 'relation', ref: 1, role: 'part' },
      ],
    },
  ];
  // Act / Assert
  for (const ordered of [elements, [...elements].reverse()]) {
    const { groupOf } = buildingGroups(ordered, center);
    expect(groupOf.get('way/6')).toBe('relation/1');
    expect(groupOf.get('way/5')).toBe('relation/1');
  }
});
it('подземный торговый комплекс не поднимает весь контур над дорогой, но его павильон остаётся виден', () => {
  // Arrange
  const elements: OSMElement[] = [
    ...square(10, 0, 0, 100, {}),
    ...square(20, 10, 10, 8, { 'building:part': 'yes', height: '3' }),
    {
      type: 'relation',
      id: 30,
      tags: {
        type: 'multipolygon',
        building: 'retail',
        location: 'underground',
        layer: '-1',
        'building:levels:underground': '4',
      },
      members: [{ type: 'way', ref: 10, role: 'outer' }],
    },
  ];
  // Act
  const world = buildWorld({
    center,
    elements,
    drivingSide: 'right',
    fetchedAt: 'test',
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  });
  // Assert
  expect(world.buildings.map((b) => b.id)).toEqual([20]);
});
it('мелкие приподнятые детали не уменьшают оболочку высотного отеля', () => {
  // Arrange
  const footprint = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
    { x: 100, y: 0, z: 100 },
    { x: 0, y: 0, z: 100 },
  ];
  const parent: Building = {
    id: 1,
    osmType: 'relation',
    footprint,
    height: 48,
    colour: 0.5,
    roof: 'flat',
    group: 'relation/1',
  };
  const detail: Building = {
    id: 2,
    footprint: [
      { x: 2, y: 0, z: 2 },
      { x: 4, y: 0, z: 2 },
      { x: 4, y: 0, z: 4 },
      { x: 2, y: 0, z: 4 },
    ],
    height: 19.5,
    minHeight: 17.5,
    part: true,
    colour: 0.5,
    roof: 'flat',
    group: 'relation/1',
  };
  const upper: Building = { ...detail, id: 3, height: 53, minHeight: 50 };
  // Act
  resolveBuildingEnvelopes([parent, detail, upper]);
  // Assert
  expect(parent.envelopeHeight).toBeUndefined();
});
it('нижний узкий ярус башни получает опору до крыши общей оболочки', () => {
  // Arrange
  const parent: Building = {
    id: 1,
    footprint: [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, z: 100 },
      { x: 0, y: 0, z: 100 },
    ],
    height: 9,
    colour: 0.5,
    roof: 'flat',
    group: 'relation/1',
  };
  const lower: Building = {
    id: 2,
    footprint: [
      { x: 10, y: 0, z: 10 },
      { x: 14, y: 0, z: 10 },
      { x: 14, y: 0, z: 14 },
      { x: 10, y: 0, z: 14 },
    ],
    height: 43,
    minHeight: 37,
    part: true,
    colour: 0.5,
    roof: 'flat',
    group: 'relation/1',
  };
  const tip: Building = { ...lower, id: 3, height: 57, minHeight: 43 };
  // Act
  resolveBuildingEnvelopes([parent, lower, tip]);
  // Assert
  expect(lower.supportMinHeight).toBe(9);
  expect(tip.supportMinHeight).toBeUndefined();
});
