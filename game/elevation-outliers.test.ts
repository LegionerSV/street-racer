import { expect, it } from 'vitest';
import { sampleElevation, smoothElevation } from './geo';
import type { ElevationGrid } from './types';
import { rejectElevationOutliers } from './elevation-filter';

function slope(): ElevationGrid {
  const width = 81,
    size = 1600;
  return {
    width,
    size,
    values: Float32Array.from(
      { length: width ** 2 },
      (_, i) => 100 + ((i % width) - 40) * 20 * 0.06,
    ),
  };
}

it.each([-60, 60])(
  'выброс %s м удаляется до того, как очистка DEM разнесёт его по кварталу',
  (spike) => {
    // Arrange
    const clean = slope(),
      dirty = { ...clean, values: clean.values.slice() };
    dirty.values[40 * clean.width + 40] += spike;
    const original = dirty.values.slice();
    // Act
    const expected = smoothElevation(clean),
      actual = smoothElevation(dirty);
    // Assert — оцениваем весь окружающий профиль, а не только ячейку выброса.
    for (let x = -400; x <= 400; x += 20) {
      expect(
        Math.abs(
          sampleElevation(actual, x, 0) - sampleElevation(expected, x, 0),
        ),
      ).toBeLessThan(0.5);
    }
    expect(dirty.values).toEqual(original);
  },
);

it('не создаёт ложную низину из нескольких соседних ошибочных отсчётов', () => {
  // Arrange
  const clean = slope(),
    dirty = { ...clean, values: clean.values.slice() };
  for (let z = 39; z <= 41; z++)
    for (let x = 39; x <= 41; x++) dirty.values[z * clean.width + x] -= 40;
  // Act
  const expected = smoothElevation(clean),
    actual = smoothElevation(dirty);
  // Assert
  for (let x = -400; x <= 400; x += 20)
    expect(
      Math.abs(sampleElevation(actual, x, 0) - sampleElevation(expected, x, 0)),
    ).toBeLessThan(0.5);
});

it.each([-30, 30])(
  'исключает изолированный перепад %s м за один метр',
  (spike) => {
    // Arrange
    const values = new Float32Array(21 ** 2).fill(8);
    values[10 * 21 + 10] += spike;
    // Act
    const result = rejectElevationOutliers({ width: 21, size: 20, values });
    // Assert
    expect([...result.values]).toEqual(
      Array.from({ length: values.length }, () => 8),
    );
    expect(values[10 * 21 + 10]).toBe(8 + spike);
  },
);

it.each([-0.5, -0.12, 0, 0.12, 0.5])(
  'сохраняет протяжённый склон с уклоном %s, включая края',
  (grade) => {
    // Arrange
    const width = 21,
      size = 400;
    const values = Float32Array.from(
      { length: width ** 2 },
      (_, i) =>
        100 +
        ((i % width) - 10) * 20 * grade +
        (Math.floor(i / width) - 10) * 20 * 0.08,
    );
    // Act
    const result = rejectElevationOutliers({ width, size, values });
    // Assert
    expect(result.values).toEqual(values);
  },
);

it.each([
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 20],
])('восстанавливает выброс по наклону соседей в ячейке %s, %s', (x, z) => {
  // Arrange
  const width = 21,
    size = 400;
  const original = Float32Array.from(
    { length: width ** 2 },
    (_, i) =>
      100 +
      ((i % width) - 10) * 20 * 0.06 +
      (Math.floor(i / width) - 10) * 20 * 0.03,
  );
  const values = original.slice();
  values[z * width + x] += 60;
  // Act
  const result = rejectElevationOutliers({ width, size, values });
  // Assert
  for (let i = 0; i < values.length; i++)
    expect(result.values[i]).toBeCloseTo(original[i], 4);
});

it('не принимает широкую вершину и устойчивую ступень рельефа за единичные выбросы', () => {
  // Arrange
  const width = 81,
    size = 1600;
  const hill = Float32Array.from({ length: width ** 2 }, (_, i) => {
    const x = ((i % width) - 40) * 20,
      z = (Math.floor(i / width) - 40) * 20;
    return 100 * Math.exp(-(x * x + z * z) / (2 * 400 ** 2));
  });
  const step = Float32Array.from({ length: width ** 2 }, (_, i) =>
    i % width < 40 ? 5 : 35,
  );
  // Act / Assert — высокий склон и обрыв сами по себе не доказывают ошибку DEM.
  for (const values of [hill, step])
    expect(rejectElevationOutliers({ width, size, values }).values).toEqual(
      values,
    );
});

it.each([3, 6])(
  'переход около статистического порога %s м не создаёт скачка',
  (height) => {
    // Arrange
    const make = (h: number) => {
      const values = new Float32Array(21 ** 2);
      values[220] = h;
      return { width: 21, size: 20, values };
    };
    // Act
    const below = rejectElevationOutliers(make(height - 0.01)),
      above = rejectElevationOutliers(make(height + 0.01));
    // Assert
    expect(Math.abs(below.values[220] - above.values[220])).toBeLessThan(0.03);
  },
);

it('подавляет изолированный выступ и на разреженной сетке при разрешённом сглаживании малых холмов', () => {
  // Arrange
  const values = new Float32Array(21 ** 2);
  values[220] = 30;
  // Act
  const dense = rejectElevationOutliers({ width: 21, size: 20, values });
  const sparse = rejectElevationOutliers({ width: 21, size: 4000, values });
  // Assert — одиночный 30-метровый холм неоднозначен; по согласованной политике
  // его разрешено сглаживать. Сохранение протяжённых склонов проверяется отдельно.
  expect(dense.values[220]).toBe(0);
  expect(sparse.values[220]).toBe(0);
});

it('сомнительный сосед теряет влияние постепенно, не переключая высоту восстанавливаемой точки', () => {
  // Arrange
  const make = (neighbour: number) => {
    const values = new Float32Array(121);
    values[60] = 30;
    values[61] = neighbour;
    return { width: 11, size: 10, values };
  };
  // Act
  const a = rejectElevationOutliers(make(2.99));
  const b = rejectElevationOutliers(make(3.01));
  // Assert
  expect(Math.abs(a.values[60] - b.values[60])).toBeLessThan(0.005);
});
