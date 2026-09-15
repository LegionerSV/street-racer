import { expect, it } from 'vitest';
import { treeInstances } from './tree-instances';

it('собирает разные развесистые кроны из повторно используемых ветвей и отдельных объёмов листвы', () => {
  // Arrange
  const trees = [{ x: 10, y: 0, z: 20 }, { x: 35, y: 0, z: 41 }];
  // Act
  const shapes = treeInstances(trees);
  // Assert
  expect(shapes.trunks.length).toBe(2 * 16);
  expect(shapes.branches.length).toBe(2 * 3 * 16);
  expect(shapes.leaves.length).toBe(2 * 5 * 16);
  expect(Array.from(shapes.leaves.slice(0, 5 * 16))).not.toEqual(Array.from(shapes.leaves.slice(5 * 16)));
  expect(shapes.leaves.every(Number.isFinite)).toBe(true);
});
