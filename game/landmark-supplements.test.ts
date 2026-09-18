import { expect, it } from 'vitest';
import { addLandmarkSupplements } from './landmark-supplements';
import type { Building } from './types';

const cathedral = (): Building => ({
  id: 2594681,
  osmType: 'relation',
  footprint: [
    { x: 340, y: 0, z: -80 },
    { x: 410, y: 0, z: -80 },
    { x: 410, y: 0, z: -20 },
    { x: 340, y: 0, z: -20 },
  ],
  height: 18,
  roof: 'flat',
  colour: 0.5,
  osmTags: { wikidata: 'Q736587', name: 'Петропавловский собор' },
});

it('добавляет отсутствующую в OSM-поставке колокольню и золотой шпиль Петропавловского собора', () => {
  // Arrange
  const buildings = [cathedral()];
  // Act
  addLandmarkSupplements(buildings, {
    lat: 59.9507126136694,
    lon: 30.309850676511555,
  });
  // Assert
  expect(buildings[0]).toMatchObject({
    height: 32,
    facadeColour: '#e2cf91',
    windowPolicy: 'procedural',
  });
  const parts = buildings.filter((building) => building.part);
  expect(parts).toHaveLength(3);
  expect(Math.max(...parts.map((part) => part.height))).toBe(122.5);
  expect(parts.find((part) => part.height === 122.5)).toMatchObject({
    roof: 'cone',
    roofMaterial: 'gold',
    roofColour: 'gold',
    minHeight: 70,
  });
});

it('не дублирует шпиль, если детальная башня уже появилась в данных', () => {
  // Arrange
  const existing: Building = {
    ...cathedral(),
    id: 900,
    part: true,
    height: 122.5,
    footprint: cathedral().footprint.map((point) => ({ ...point, x: point.x + 2 })),
  };
  const buildings = [cathedral(), existing];
  // Act
  addLandmarkSupplements(buildings, {
    lat: 59.9507126136694,
    lon: 30.309850676511555,
  });
  // Assert
  expect(buildings.filter((building) => building.height >= 100)).toEqual([
    existing,
  ]);
});
