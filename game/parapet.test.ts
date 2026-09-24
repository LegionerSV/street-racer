import { expect, it } from 'vitest';
import { appendParapet } from './parapet';
import type { MeshData } from './types';

it.each([-1, 1])(
  'строит объёмный парапет с верхней плитой вдоль склона, сторона %s',
  (side) => {
    // Arrange
    const mesh: MeshData = { positions: [], indices: [], colors: [] };
    // Act
    appendParapet(mesh, { x: 0, y: 2, z: 0 }, { x: 10, y: 4, z: 0 }, side);
    // Assert
    expect(mesh.indices.length).toBeGreaterThan(6);
    expect(mesh.colors).toHaveLength((mesh.positions.length / 3) * 4);
    const points = Array.from({ length: mesh.positions.length / 3 }, (_, i) =>
      mesh.positions.slice(i * 3, i * 3 + 3),
    );
    expect(
      Math.max(...points.map((p) => p[2])) -
        Math.min(...points.map((p) => p[2])),
    ).toBeCloseTo(0.6);
    expect(
      Math.max(...points.filter((p) => p[0] === 0).map((p) => p[1])),
    ).toBeCloseTo(3.1);
    expect(
      Math.max(...points.filter((p) => p[0] === 10).map((p) => p[1])),
    ).toBeCloseTo(5.1);
    expect(points.every((p) => -p[2] * side >= -0.001)).toBe(true);
  },
);

it('не создаёт геометрию для нулевой секции', () => {
  // Arrange
  const mesh: MeshData = { positions: [], indices: [], colors: [] };
  const point = { x: 0, y: 0, z: 0 };
  // Act
  appendParapet(mesh, point, point, 1);
  // Assert
  expect(mesh.positions).toEqual([]);
  expect(mesh.indices).toEqual([]);
});

it.each([-1, 1])(
  'стыкует соседние секции на повороте без щелей, сторона %s',
  (side) => {
    // Arrange
    const first: MeshData = { positions: [], indices: [], colors: [] };
    const second: MeshData = { positions: [], indices: [], colors: [] };
    const a = { x: 0, y: 2, z: 0 },
      joint = { x: 10, y: 3, z: 0 },
      b = { x: 10, y: 4, z: 10 };
    const miter = { x: 1, z: -1 };
    // Act
    appendParapet(first, a, joint, side, { x: 0, z: -1 }, miter);
    appendParapet(second, joint, b, side, miter, { x: 1, z: 0 });
    // Assert
    for (const [width, height] of [
      [0.6, 0],
      [0.6, 0.16],
      [0.46, 0.16],
      [0.46, 0.94],
      [0.6, 0.94],
      [0.6, 1.1],
    ]) {
      const expected = [
        joint.x + width * side,
        joint.y + height,
        joint.z - width * side,
      ];
      for (const mesh of [first, second]) {
        const points = Array.from(
          { length: mesh.positions.length / 3 },
          (_, i) => mesh.positions.slice(i * 3, i * 3 + 3),
        );
        expect(
          points.some((p) =>
            p.every((v, i) => Math.abs(v - expected[i]) < 1e-6),
          ),
        ).toBe(true);
      }
    }
  },
);
