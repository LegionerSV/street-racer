import { expect, it } from 'vitest';
import { buildingGroups } from './building-groups';
import { reduceMapElements } from './map-element-filter';
import type { OSMElement } from './types';
const center = { lat: 0, lon: 0 };
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
  expect(
    reduceMapElements(elements, center, 'roads').elements.some(
      (e) => e.tags?.building,
    ),
  ).toBe(false);
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
  const { groupOf } = buildingGroups(elements, center);
  // Assert
  expect(groupOf.get('way/1')).toBe('relation/1');
  expect(groupOf.get('way/2')).toBe('relation/1');
  expect(groupOf.has('way/999')).toBe(false);
  expect(reduceMapElements(elements, center).elements.length).toBe(
    elements.length,
  );
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
