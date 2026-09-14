import { expect, it } from 'vitest';
import { sampleGroundFootprint } from './dem-sampling';

it('сохраняет низкий отсчёт земли при укрупнении ячейки DEM', () => {
  // Arrange — одиночная выборка в центре попала бы на соседнюю крышу.
  const sample = (x: number, y: number) => (x === 10 && y === 11 ? 4 : 35);
  // Act
  const a = sampleGroundFootprint(10.1, 10.2, 80, 60, 12, sample);
  const b = sampleGroundFootprint(10.7, 10.8, 80, 60, 12, sample);
  // Assert
  expect(a).toBe(4);
  expect(b).toBe(4);
});

it('не выдумывает значения за пределами доступных пикселей', () => {
  // Arrange / Act
  const h = sampleGroundFootprint(0, 0, 80, 60, 12, (x, y) =>
    x === 0 && y === 0 ? -7 : undefined,
  );
  // Assert
  expect(h).toBe(-7);
  expect(
    sampleGroundFootprint(0, 0, 80, 60, 12, () => undefined),
  ).toBeUndefined();
});
