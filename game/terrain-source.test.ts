import { expect, it } from 'vitest';
import { sampleElevation, sampleRoadElevation, smoothElevation } from './geo';
import type { ElevationGrid } from './types';
import {
  TERRAIN_GRID_SIZE,
  TERRAIN_GRID_WIDTH,
  TERRAIN_CORRECTION_LIMIT,
} from './terrain-policy';

it.each(
  [0, 0.06, -0.06].flatMap((grade) =>
    [-30, 30].map((error) => ({ grade, error })),
  ),
)(
  'подавляет единичную ошибку $error м до широкого фильтра при уклоне $grade',
  ({ grade, error }) => {
    // Arrange — ошибка в одной ячейке новой сетки должна исчезнуть до открытия.
    const width = TERRAIN_GRID_WIDTH,
      size = TERRAIN_GRID_SIZE;
    const grid: ElevationGrid = {
      width,
      size,
      values: Float32Array.from(
        { length: width ** 2 },
        (_, i) =>
          10 + ((((i % width) - (width - 1) / 2) * size) / (width - 1)) * grade,
      ),
    };
    const dirty = { ...grid, values: grid.values.slice() };
    dirty.values[(width ** 2 - 1) / 2] += error;
    // Act
    const expected = smoothElevation(grid),
      actual = smoothElevation(dirty);
    // Assert
    for (const x of [-600, -300, 0, 300, 600])
      expect(sampleElevation(actual, x, 0)).toBeCloseTo(
        sampleElevation(expected, x, 0),
        3,
      );
  },
);

it('не меняет политику фильтра при пересчёте ширины в систему координат сессии', () => {
  // Arrange — size остаётся физической шириной источника, sizeX меняется с широтой сессии.
  const width = TERRAIN_GRID_WIDTH,
    size = TERRAIN_GRID_SIZE;
  const grid: ElevationGrid = {
    width,
    size,
    values: Float32Array.from({ length: width ** 2 }, (_, i) => {
      const x = ((i % width) / (width - 1) - 0.5) * size;
      const z = (Math.floor(i / width) / (width - 1) - 0.5) * size;
      return 25 * Math.exp(-(x * x + z * z) / (2 * 400 ** 2));
    }),
  };
  // Act
  const original = smoothElevation(grid),
    transformed = smoothElevation({ ...grid, sizeX: size * 0.98 });
  // Assert
  expect(sampleElevation(transformed, 0, 0)).toBeCloseTo(
    sampleElevation(original, 0, 0),
    4,
  );
  expect(transformed.sampleInsetX).toBeCloseTo(
    original.sampleInsetX! * 0.98,
    4,
  );
});

it.each(
  [0, 40, -25].flatMap((datum) =>
    [0, 0.06, -0.06].map((grade) => ({ datum, grade })),
  ),
)(
  'ограничивает сглаживание высокого холма при смещении $datum м и фоновом уклоне $grade',
  ({ datum, grade }) => {
    // Arrange — по согласованной политике малые холмы можно сглаживать,
    // но весь высокий рельеф нельзя превращать в плоскость.
    const width = TERRAIN_GRID_WIDTH,
      size = TERRAIN_GRID_SIZE,
      step = size / (width - 1);
    const values = Float32Array.from({ length: width * width }, (_, i) => {
      const x = ((i % width) - (width - 1) / 2) * step,
        z = (Math.floor(i / width) - (width - 1) / 2) * step;
      return (
        datum + x * grade + 100 * Math.exp(-(x * x + z * z) / (2 * 400 ** 2))
      );
    });
    const grid: ElevationGrid = { width, size, values },
      original = values.slice();
    // Act
    const result = smoothElevation(grid);
    // Assert — до 30 м игровой коррекции плюс небольшой эффект размытия.
    expect(sampleElevation(result, 0, 0) - datum).toBeGreaterThan(
      100 - TERRAIN_CORRECTION_LIMIT - 2,
    );
    expect(sampleElevation(result, 0, 0) - datum).toBeLessThanOrEqual(100);
    expect(grid.values).toEqual(original);
  },
);

it.each([-0.12, -0.06, 0, 0.06, 0.12])(
  'сохраняет масштаб протяжённого уклона %s с полным запасом DEM',
  (grade) => {
    // Arrange
    const width = TERRAIN_GRID_WIDTH,
      size = TERRAIN_GRID_SIZE,
      step = size / (width - 1);
    const values = Float32Array.from(
      { length: width ** 2 },
      (_, i) => 80 + ((i % width) - (width - 1) / 2) * step * grade,
    );
    // Act
    const result = smoothElevation({ width, size, values });
    // Assert
    for (const x of [-600, -300, 0, 300, 600])
      expect(sampleElevation(result, x, 0)).toBeCloseTo(80 + x * grade, 3);
  },
);

it.each([sampleElevation, sampleRoadElevation])(
  'не подмешивает край фильтра из далёкого тайла',
  (sample) => {
    // Arrange — расширение DEM не расширяет достоверную область результата.
    const patch = (offsetX: number, h: number): ElevationGrid => ({
      width: 3,
      size: 10000,
      offsetX,
      sampleInsetX: 4400,
      sampleInsetZ: 4400,
      values: new Float32Array(9).fill(h),
    });
    const base: ElevationGrid = {
      width: 2,
      size: 1,
      values: new Float32Array(4),
      patches: [patch(0, 5)],
    };
    // Act / Assert
    expect(
      sample({ ...base, patches: [...base.patches!, patch(2000, 300)] }, 0, 0),
    ).toBe(sample(base, 0, 0));
  },
);

it.each([
  ['земля', sampleElevation],
  ['дороги', sampleRoadElevation],
] as const)(
  'стыкует несовпадающие отсчёты соседних сеток непрерывно: %s',
  (_name, sample) => {
    // Arrange — одинаковый источник, но разные сетки ресэмплинга дают несовпадение.
    const patch = (offsetX: number, bias: number): ElevationGrid => ({
      width: 51,
      size: 2000,
      offsetX,
      values: Float32Array.from(
        { length: 51 ** 2 },
        (_, i) => (offsetX + ((i % 51) - 25) * 40) * 0.03 + bias,
      ),
    });
    const grid: ElevationGrid = {
      width: 2,
      size: 1,
      values: new Float32Array(4),
      patches: [patch(-300, 0), patch(300, 1)],
    };
    // Act
    const left = sample(grid, -0.001, 0),
      right = sample(grid, 0.001, 0);
    // Assert
    expect(Math.abs(right - left)).toBeLessThan(0.001);
    expect(
      sample({ ...grid, patches: [...grid.patches!].reverse() }, 0, 0),
    ).toBeCloseTo(sample(grid, 0, 0), 8);
  },
);

it('малое изменение входной высоты не переключает фильтр на другую поверхность', () => {
  // Arrange — старое условие «выше 5 м» давало скачок почти на пять метров.
  const make = (height: number): ElevationGrid => ({
    width: 81,
    size: 1600,
    values: Float32Array.from({ length: 81 ** 2 }, (_, i) =>
      Math.abs((i % 81) - 40) < 8 && Math.abs(Math.floor(i / 81) - 40) < 8
        ? height
        : 0,
    ),
  });
  // Act
  const below = smoothElevation(make(4.99)),
    above = smoothElevation(make(5.01));
  // Assert
  expect(
    Math.abs(sampleElevation(below, 0, 0) - sampleElevation(above, 0, 0)),
  ).toBeLessThan(0.03);
});
