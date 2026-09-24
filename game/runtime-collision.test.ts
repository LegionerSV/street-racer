import { expect, it } from 'vitest';
import { isStaticCollisionRole, mergeStaticCollisionData, mergeStaticCollisionDataSteps, stageChunkMesh, swapChunkCollisionBodies } from './runtime';
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
  const steps = mergeStaticCollisionDataSteps(chunk);
  let count = 0;
  let next = steps.next();
  while (!next.done) { count++; next = steps.next(); }
  expect(count).toBe(20);
  expect(next.value).toEqual(collision);
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

it('включает новый коллайдер и удаляет старый в одном шаге установки', () => {
  // Arrange
  const events: string[] = [], bodies: string[] = [];
  const old = { dispose: () => { events.push('old-disposed'); } };
  const staged: { mesh: { isEnabled: () => boolean; setEnabled: (enabled: boolean) => void }; enabled: boolean }[] = [];
  const mesh = { isEnabled: () => true, setEnabled: (enabled: boolean) => { events.push(enabled ? 'new-visible' : 'new-hidden'); } };
  stageChunkMesh(mesh, staged);

  // Act
  swapChunkCollisionBodies(['mesh'], (mesh) => {
    events.push('new-active');
    return mesh;
  }, bodies, old, () => staged.forEach((item) => item.mesh.setEnabled(item.enabled)));

  // Assert
  expect(events).toEqual(['new-hidden', 'new-visible', 'new-active', 'old-disposed']);
  expect(bodies).toEqual(['mesh']);
});

it('сохраняет старую коллизию, если новая не создалась', () => {
  // Arrange
  const events: string[] = [], bodies: string[] = [];
  // Act / Assert
  expect(() => swapChunkCollisionBodies(['mesh'], () => { throw new Error('shape'); }, bodies,
    { dispose: () => { events.push('old-disposed'); } })).toThrow('shape');
  expect(events).toEqual([]);
  expect(bodies).toEqual([]);
});
