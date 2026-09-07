import { describe, expect, it } from 'vitest';
import { toLocal, toGeo, sampleElevation, tileKey, decodeTerrarium } from './geo';

describe('Координаты и рельеф', () => {
  it('сохраняет местоположение при переводе в метры и обратно', () => {
    // Arrange
    const center = { lat: 55.75, lon: 37.61 };
    // Act
    const p = toGeo(toLocal(55.76, 37.64, center), center);
    // Assert
    expect(p.lat).toBeCloseTo(55.76, 8); expect(p.lon).toBeCloseTo(37.64, 8);
  });
  it('интерполирует высоту на общем стыке кварталов без скачка', () => {
    // Arrange
    const grid = { size: 5000, width: 2, values: new Float32Array([0, 10, 20, 30]) };
    // Act
    const a = sampleElevation(grid, 250 - 0.001, 0), b = sampleElevation(grid, 250 + 0.001, 0);
    // Assert
    expect(a).toBeCloseTo(b, 4); expect(tileKey(-1, -1)).toBe('-1,-1');
  });
  it('декодирует положительные и отрицательные отметки Terrarium', () => {
    // Arrange / Act / Assert
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });
});
