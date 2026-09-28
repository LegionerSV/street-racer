import { expect, it } from 'vitest';
import { latLonToSourceTile, sourceTileKey } from '../game/source-tiles';
import { railFeatureTiles } from './generate-rail-overlay';

it('выбирает только покрытые тайлы рядом с действующим путём и вокзалом', () => {
  // Arrange
  const center = latLonToSourceTile(59.93, 30.3);
  const key = sourceTileKey(center);
  const coverage = new Set([key]);
  // Act
  const rail = railFeatureTiles(
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [30.3, 59.93],
          [30.301, 59.93],
        ],
      },
      properties: { railway: 'rail' },
    },
    coverage,
  );
  const station = railFeatureTiles(
    {
      geometry: { type: 'Point', coordinates: [30.3, 59.93] },
      properties: { railway: 'station' },
    },
    coverage,
  );
  const disused = railFeatureTiles(
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [30.3, 59.93],
          [30.301, 59.93],
        ],
      },
      properties: { railway: 'disused' },
    },
    coverage,
  );
  // Assert
  expect(rail).toEqual([key]);
  expect(station).toEqual([key]);
  expect(disused).toEqual([]);
});

it('включает в петербургский overlay тайлы с контуром судна', () => {
  // Arrange
  const key = sourceTileKey(latLonToSourceTile(59.955, 30.337));
  const coverage = new Set([key]);
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [
        [30.337, 59.955],
        [30.3374, 59.955],
        [30.3374, 59.9551],
        [30.337, 59.955],
      ],
    ],
  };
  // Act
  const ship = railFeatureTiles(
    { geometry, properties: { building: 'ship', historic: 'ship' } },
    coverage,
  );
  const restaurant = railFeatureTiles(
    { geometry, properties: { building: 'ship', amenity: 'restaurant' } },
    coverage,
  );
  const closedWay = railFeatureTiles(
    {
      geometry: { type: 'LineString', coordinates: geometry.coordinates[0] },
      properties: { building: 'ship' },
    },
    coverage,
  );
  const house = railFeatureTiles(
    { geometry, properties: { building: 'house' } },
    coverage,
  );
  // Assert
  expect(ship).toEqual([key]);
  expect(restaurant).toEqual([key]);
  expect(closedWay).toEqual([key]);
  expect(house).toEqual([]);
});

it('не выбирает пустой угол прямоугольника, описанного вокруг длинного пути', () => {
  // Arrange
  const onTrack = sourceTileKey(latLonToSourceTile(59.93, 30.31));
  const offTrack = sourceTileKey(latLonToSourceTile(59.95, 30.3));
  const coverage = new Set([onTrack, offTrack]);
  // Act
  const selected = railFeatureTiles(
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [30.3, 59.93],
          [30.32, 59.93],
          [30.32, 59.95],
        ],
      },
      properties: { railway: 'rail' },
    },
    coverage,
  );
  // Assert
  expect(selected).toContain(onTrack);
  expect(selected).not.toContain(offTrack);
});
