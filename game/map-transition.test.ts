import { expect, it } from 'vitest';
import {
  mapStreamCanUpdate,
  mapTransitionBlocksDriving,
  mapTransitionChunks,
} from './runtime';

it('перед переключением карты готовит только грязные кварталы под машиной', () => {
  // Arrange
  // Act
  const result = mapTransitionChunks(
    ['0,0', '1,0', '3,0', '4,0'],
    ['0,0', '3,0'],
  );

  // Assert
  expect(result).toEqual([
    { key: '0,0', lod: 0 },
    { key: '3,0', lod: 0 },
  ]);
});

it('автопроезд и гонка продолжают подгружать карту, а скрытая вкладка ждёт', () => {
  // Arrange
  const state = {
    preparingRaceActive: false,
    raceActive: false,
    driveTestActive: true,
    hidden: false,
  };
  // Act / Assert
  expect(mapStreamCanUpdate(state)).toBe(true);
  expect(mapStreamCanUpdate({ ...state, raceActive: true })).toBe(true);
  expect(mapStreamCanUpdate({ ...state, hidden: true })).toBe(false);
});

it('не останавливает машину ради перестройки далёких кварталов', () => {
  // Arrange
  const critical = ['0,0', '0,1'];
  // Act / Assert
  expect(mapTransitionBlocksDriving(['4,4', '5,4'], critical)).toBe(false);
  expect(mapTransitionBlocksDriving(['4,4', '0,1'], critical)).toBe(true);
});
