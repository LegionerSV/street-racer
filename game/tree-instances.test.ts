import { expect, it } from 'vitest';
import { treeInstances } from './tree-instances';

it('собирает разные развесистые кроны из повторно используемых ветвей и отдельных объёмов листвы', () => {
  // Arrange
  const trees = [
    { x: 10, y: 0, z: 20 },
    { x: 35, y: 0, z: 41 },
  ];
  // Act
  const shapes = treeInstances(trees);
  // Assert
  expect(shapes.trunks.length).toBe(2 * 16);
  expect(shapes.branches.length).toBe(2 * 3 * 16);
  expect(shapes.leaves.length).toBe(2 * 5 * 16);
  expect(Array.from(shapes.leaves.slice(0, 5 * 16))).not.toEqual(
    Array.from(shapes.leaves.slice(5 * 16)),
  );
  expect(shapes.leaves.every(Number.isFinite)).toBe(true);
});

it('выводит концы основных ветвей из центрального объёма кроны', () => {
  // Arrange / Act
  const shapes = treeInstances([{ x: 0, y: 0, z: 0 }]),
    central = Array.from(shapes.leaves.slice(0, 16)),
    centralRadius = Math.hypot(central[0], central[2]) * 3.1;
  const tips = Array.from({ length: 3 }, (_, index) => {
    const m = Array.from(shapes.branches.slice(index * 16, index * 16 + 16));
    return { x: m[12] + m[4] * 1.75, z: m[14] + m[6] * 1.75 };
  });
  // Assert
  expect(
    tips.filter((tip) => Math.hypot(tip.x, tip.z) > centralRadius).length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    tips.every((tip) => Number.isFinite(tip.x) && Number.isFinite(tip.z)),
  ).toBe(true);
});
