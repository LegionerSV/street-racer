import { expect, it } from 'vitest';
import { carriagewayTransitions } from './carriageways';
import { smoother } from './geo';

it('сохраняет дальнее влияние второй опоры после слияния ветвей графа', () => {
  // Arrange — малая поправка ближе к узлу 3, но её радиуса не хватает до узла 4.
  const edge = (from: number, to: number, length: number) => ({
    from,
    to,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: length, y: 0, z: 0 },
    ],
  });
  const edges = [edge(1, 3, 10), edge(2, 3, 100), edge(3, 4, 60)];
  const anchors = new Map([
    [1, 0.4],
    [2, 4.8],
  ]);
  // Act
  const heights = carriagewayTransitions(edges, anchors);
  const reordered = carriagewayTransitions(
    [...edges].reverse(),
    new Map([...anchors].reverse()),
  );
  // Assert — приоритет в промежуточном узле не уничтожает другой источник.
  const a = 1 - smoother(10 / 60),
    b = 1 - smoother(100 / 300);
  expect(heights.get(3)).toBeCloseTo(
    ((0.4 * a * a) / 10 + (4.8 * b * b) / 100) / (a / 10 + b / 100),
    8,
  );
  expect(heights.get(4)).toBeCloseTo(4.8 * (1 - smoother(160 / 300)), 8);
  expect(reordered).toEqual(heights);
  expect(anchors).toEqual(
    new Map([
      [1, 0.4],
      [2, 4.8],
    ]),
  );
});
