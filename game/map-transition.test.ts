import { expect, it } from 'vitest';
import {
  mapStreamCanUpdate,
  mapTransitionBlocksDriving,
  mapTransitionChunks,
  raceChunkNeedsPreparation,
  criticalChunkLoadingReason,
} from './runtime';

it.each([
  [false, true, 0, true, 'coverage'],
  [true, true, 0, true, undefined],
  [true, true, 1, true, 'stale-chunk'],
  [true, true, undefined, true, 'stale-chunk'],
  [true, false, undefined, true, 'chunk'],
  [true, false, 0, true, undefined],
  [true, false, undefined, false, undefined],
])(
  'движение при обновлении: coverage=%s stale=%s lod=%s wanted=%s',
  (coverageReady, stale, installedLod, wanted, expected) => {
    // Arrange / Act / Assert
    expect(
      criticalChunkLoadingReason(coverageReady, stale, installedLod, wanted),
    ).toBe(expected);
  },
);

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
  expect(
    mapStreamCanUpdate({
      ...state,
      preparingRaceActive: true,
      raceCoverageLoading: true,
    }),
  ).toBe(true);
  expect(mapStreamCanUpdate({ ...state, preparingRaceActive: true })).toBe(
    false,
  );
  expect(mapStreamCanUpdate({ ...state, hidden: true })).toBe(false);
});

it('не останавливает машину ради перестройки далёких кварталов', () => {
  // Arrange
  const critical = ['0,0', '0,1'];
  // Act / Assert
  expect(mapTransitionBlocksDriving(['4,4', '5,4'], critical)).toBe(false);
  expect(mapTransitionBlocksDriving(['4,4', '0,1'], critical)).toBe(true);
});

it.each([
  [undefined, 0, false, true],
  [1, 0, false, true],
  [0, 0, true, true],
  [0, 0, false, false],
])(
  'готовность race-чанка: installed=%s target=%s stale=%s => rebuild=%s',
  (installed, target, stale, expected) => {
    // Arrange / Act / Assert
    expect(raceChunkNeedsPreparation(installed, target, stale)).toBe(expected);
  },
);
