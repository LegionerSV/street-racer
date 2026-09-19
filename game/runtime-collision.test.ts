import { expect, it } from 'vitest';
import { isStaticCollisionRole, mergeStaticCollisionData } from './runtime';
import type { ChunkData, MeshData } from './types';

it('создаёт один Havok-коллайдер на подробный чанк', () => {
  // Arrange.
  const roles = ['terrain', 'buildings', 'facade0', 'paved', 'collision'];

  // Act.
  const collisions = roles.map((role) => isStaticCollisionRole(role, 0));

  // Assert.
  expect(collisions).toEqual([false, false, false, false, true]);
  expect(isStaticCollisionRole('collision', 1)).toBe(false);
});

it('объединяет разрозненные статические поверхности без изменения треугольников', () => {
  // Arrange.
  const mesh = (x: number): MeshData => ({
    positions: [x, 0, 0, x + 1, 0, 0, x, 0, 1],
    indices: [0, 1, 2],
  });
  const chunk = {
    lod: 0,
    terrain: mesh(0),
    road: mesh(2),
    paved: mesh(4),
    shoulders: mesh(6),
    sidewalks: mesh(7),
    markings: mesh(100),
    structures: mesh(8),
    treeTrunks: mesh(10),
    buildings: mesh(12),
    windows: mesh(100),
    water: mesh(100),
    facades: [mesh(14)],
    bareFacades: [mesh(16)],
  } as ChunkData;
  // Act.
  const collision = mergeStaticCollisionData(chunk);
  // Assert.
  expect(collision.indices).toHaveLength(10 * 3);
  expect(collision.indices.slice(-3)).toEqual([27, 28, 29]);
  expect(collision.positions).not.toContain(100);
});


it('объединяет крупный чанк без превышения лимита аргументов JavaScript', () => {
  // Arrange.
  const positions = Array.from({ length: 210000 }, (_, index) => index % 3);
  const chunk = {
    lod: 0,
    terrain: { positions, indices: [0, 1, 2] },
  } as ChunkData;
  // Act.
  const collision = mergeStaticCollisionData(chunk);
  // Assert.
  expect(collision.positions).toHaveLength(positions.length);
  expect(collision.indices).toEqual([0, 1, 2]);
});
