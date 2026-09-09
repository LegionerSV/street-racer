import { describe, expect, it } from 'vitest';
import {
  SOURCE_TILE_ZOOM,
  WEB_MERCATOR_MAX_LATITUDE,
  isValidSourceTileY,
  latLonToSourceTile,
  normalizeSourceTileX,
  sourceTileBounds,
} from './source-tiles';

describe('Глобальные source-тайлы Web Mercator', () => {
  it('детерминированно вычисляет XYZ для Москвы и Санкт-Петербурга', () => {
    // Arrange
    const moscow = { lat: 55.7558, lon: 37.6173 };
    const saintPetersburg = { lat: 59.9343, lon: 30.3351 };

    // Act
    const moscowTile = latLonToSourceTile(moscow.lat, moscow.lon);
    const saintPetersburgTile = latLonToSourceTile(
      saintPetersburg.lat,
      saintPetersburg.lon,
    );

    // Assert
    expect(moscowTile).toEqual({ z: 15, x: 19808, y: 10243 });
    expect(saintPetersburgTile).toEqual({ z: 15, x: 19145, y: 9527 });
    expect(latLonToSourceTile(moscow.lat, moscow.lon)).toEqual(moscowTile);
  });

  it('относит центр тайла к исходному XYZ', () => {
    // Arrange
    const id = { z: SOURCE_TILE_ZOOM, x: 19808, y: 10243 };
    const bounds = sourceTileBounds(id);

    // Act
    const tile = latLonToSourceTile(
      (bounds.south + bounds.north) / 2,
      (bounds.west + bounds.east) / 2,
      id.z,
    );

    // Assert
    expect(tile).toEqual(id);
  });

  it('однозначно делит точки на точных границах', () => {
    // Arrange
    const id = { z: SOURCE_TILE_ZOOM, x: 19808, y: 10243 };
    const bounds = sourceTileBounds(id);

    // Act
    const northWest = latLonToSourceTile(bounds.north, bounds.west, id.z);
    const east = latLonToSourceTile(bounds.north, bounds.east, id.z);
    const south = latLonToSourceTile(bounds.south, bounds.west, id.z);

    // Assert
    expect(northWest).toEqual(id);
    expect(east).toEqual({ ...id, x: id.x + 1 });
    expect(south).toEqual({ ...id, y: id.y + 1 });
  });

  it('сохраняет граничную семантику на высоком zoom', () => {
    // Arrange
    const id = { z: 25, x: 15134900, y: 684077 };
    const bounds = sourceTileBounds(id);

    // Act / Assert
    expect(latLonToSourceTile(bounds.north, bounds.west, id.z)).toEqual(id);
    expect(latLonToSourceTile(bounds.south, bounds.west, id.z)).toEqual({
      ...id,
      y: id.y + 1,
    });
  });

  it('не округляет точку рядом с границей до соседнего тайла', () => {
    // Arrange
    const boundary = 37.6171875;

    // Act
    const west = latLonToSourceTile(0, boundary - 5.5e-12);
    const east = latLonToSourceTile(0, boundary);

    // Assert
    expect(west.x).toBe(east.x - 1);
  });

  it('даёт совпадающие границы соседних тайлов без зазора', () => {
    // Arrange / Act
    const center = sourceTileBounds({ z: 15, x: 19808, y: 10243 });
    const east = sourceTileBounds({ z: 15, x: 19809, y: 10243 });
    const south = sourceTileBounds({ z: 15, x: 19808, y: 10244 });

    // Assert
    expect(center.east).toBe(east.west);
    expect(center.south).toBe(south.north);
  });

  it('нормализует долготу и X около линии перемены дат', () => {
    // Arrange
    const count = 2 ** SOURCE_TILE_ZOOM;

    // Act / Assert
    expect(latLonToSourceTile(0, -180)).toEqual({ z: 15, x: 0, y: 16384 });
    expect(latLonToSourceTile(0, 180)).toEqual({ z: 15, x: 0, y: 16384 });
    expect(latLonToSourceTile(0, 540)).toEqual({ z: 15, x: 0, y: 16384 });
    expect(latLonToSourceTile(0, -0.1, 2)).toEqual({ z: 2, x: 1, y: 2 });
    expect(latLonToSourceTile(0, -190).x).toBe(latLonToSourceTile(0, 170).x);
    expect(normalizeSourceTileX(-1, SOURCE_TILE_ZOOM)).toBe(count - 1);
    expect(normalizeSourceTileX(count, SOURCE_TILE_ZOOM)).toBe(0);
  });

  it('ограничивает широту и всегда возвращает допустимый Y', () => {
    // Arrange / Act
    const north = latLonToSourceTile(90, 0);
    const northLimit = latLonToSourceTile(WEB_MERCATOR_MAX_LATITUDE, 0);
    const south = latLonToSourceTile(-90, 0);
    const southLimit = latLonToSourceTile(-WEB_MERCATOR_MAX_LATITUDE, 0);

    // Assert
    expect(north).toEqual(northLimit);
    expect(north.y).toBe(0);
    expect(south).toEqual(southLimit);
    expect(south.y).toBe(2 ** SOURCE_TILE_ZOOM - 1);
    expect(isValidSourceTileY(north.y, north.z)).toBe(true);
    expect(isValidSourceTileY(-1, north.z)).toBe(false);
    expect(isValidSourceTileY(2 ** north.z, north.z)).toBe(false);
  });

  it('отклоняет некорректные XYZ и координаты', () => {
    // Arrange / Act / Assert
    expect(() => latLonToSourceTile(Number.NaN, 0)).toThrow(
      'Широта и долгота должны быть конечными числами.',
    );
    expect(() => normalizeSourceTileX(1.5, 15)).toThrow(
      'X source-тайла должен быть целым числом.',
    );
    expect(() => sourceTileBounds({ z: 15, x: 0, y: -1 })).toThrow(
      'Y source-тайла вне диапазона для zoom 15.',
    );
  });
});
