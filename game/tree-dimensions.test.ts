import { expect, it } from 'vitest';
import { treeDimensions } from './tree-dimensions';
it('даёт заметный стабильный разброс, включая высокие деревья', () => {
  // Arrange
  const trees = Array.from({ length: 200 }, (_, id) => ({
    id,
    x: id * 20,
    y: 0,
    z: 20,
  }));
  // Act
  const sizes = trees.map(treeDimensions);
  // Assert
  expect(Math.min(...sizes.map((s) => s.height))).toBeLessThan(8);
  expect(Math.max(...sizes.map((s) => s.height))).toBeGreaterThan(22);
  expect(sizes).toEqual(trees.map(treeDimensions));
  expect(treeDimensions({ ...trees[0], x: 900, z: 500 })).toEqual(sizes[0]);
});
it('учитывает явную высоту и отбрасывает некорректную', () => {
  // Arrange
  const tree = { id: 8, x: 0, y: 0, z: 0 };
  // Act / Assert
  expect(treeDimensions({ ...tree, height: 23 }).height).toBe(23);
  expect(treeDimensions({ ...tree, height: NaN })).toEqual(
    treeDimensions(tree),
  );
});
