import { expect, it } from 'vitest';
import { shorelineSpans } from './shoreline';

it('делит укреплённый берег по границам треугольников земли и кварталов', () => {
  // Arrange
  const a = { x: 240, y: 4, z: 80 },
    b = { x: 280, y: 8, z: 97 };
  // Act
  const spans = shorelineSpans(a, b);
  // Assert
  expect(spans[0].a).toEqual(a);
  expect(spans.at(-1)!.b).toEqual(b);
  expect(spans.some((s) => s.b.x === 250)).toBe(true);
  for (let i = 1; i < spans.length; i++)
    expect(spans[i].a).toEqual(spans[i - 1].b);
});
