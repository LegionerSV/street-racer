import { afterEach, expect, it, vi } from 'vitest';
import { LAST_RIDE_KEY, readLastRide, saveLastRide } from './last-ride';

afterEach(() => vi.unstubAllGlobals());

it('возвращает фактическую последнюю позицию машины', () => {
  // Arrange
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  // Act
  saveLastRide({ lat: 59.945, lon: 30.301 });
  // Assert
  expect(readLastRide()).toEqual({ lat: 59.945, lon: 30.301 });
  expect(values.has(LAST_RIDE_KEY)).toBe(true);
});

it('отвергает отсутствующее, повреждённое и недопустимое сохранение', () => {
  // Arrange
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
  });
  // Act / Assert
  expect(readLastRide()).toBeNull();
  values.set(LAST_RIDE_KEY, '{');
  expect(readLastRide()).toBeNull();
  values.set(LAST_RIDE_KEY, JSON.stringify({ version: 1, lat: 91, lon: 30 }));
  expect(readLastRide()).toBeNull();
});
