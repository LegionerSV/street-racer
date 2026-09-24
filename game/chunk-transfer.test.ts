import { expect, it } from 'vitest';
import { VertexData } from '@babylonjs/core';
import { prepareChunkTransfer } from './chunk-transfer';
import type { ChunkData, MeshData } from './types';

const empty = (): MeshData => ({ positions: [], indices: [] });
const chunk = (): ChunkData => ({
  key: '0,0',
  lod: 0,
  terrain: {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    colors: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    uvs: [0, 0, 1, 0, 0, 1],
  },
  road: empty(),
  shoulders: empty(),
  markings: empty(),
  structures: empty(),
  treeTrunks: empty(),
  buildings: empty(),
  windows: empty(),
  water: empty(),
  trees: [{ x: 1, y: 2, z: 3 }],
  lamps: [],
  breakables: [],
});

it.each([
  [0, 0, 0, 4, 0, 0, 0, 0, 3],
  [0, 0, 0, 4, 2, 0, 0, 0, 3],
  [0, 0, 0, 0, 2, 0, 0, 0, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
])(
  'worker сохраняет направление нормалей Babylon для поверхности %j',
  (...positions) => {
    // Arrange
    const source = chunk();
    source.terrain = { positions, indices: [0, 1, 2] };
    const expected: number[] = [];
    VertexData.ComputeNormals(positions, source.terrain.indices, expected);
    // Act
    const actual = prepareChunkTransfer(source).chunk.terrain.normals!;
    // Assert
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
  },
);

it('worker усредняет соседние грани разной площади как Babylon', () => {
  // Arrange
  const source = chunk();
  source.terrain = {
    positions: [0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 1, 0],
    indices: [0, 1, 2, 0, 3, 1],
  };
  const expected: number[] = [];
  VertexData.ComputeNormals(
    source.terrain.positions,
    source.terrain.indices,
    expected,
  );
  // Act
  const actual = prepareChunkTransfer(source).chunk.terrain.normals!;
  // Assert
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
});

it('передаёт геометрию чанка без тяжёлого structured clone в главном потоке', () => {
  // Arrange
  const source = chunk();

  // Act
  const prepared = prepareChunkTransfer(source);
  const terrain = prepared.chunk.terrain;

  // Assert
  expect(source.terrain.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(terrain.positions).toBeInstanceOf(Float32Array);
  expect(terrain.indices).toBeInstanceOf(Uint32Array);
  expect(terrain.normals).toBeInstanceOf(Float32Array);
  expect(terrain.normals).toHaveLength(terrain.positions.length);
  expect(terrain.colors).toBeInstanceOf(Float32Array);
  expect(terrain.uvs).toBeInstanceOf(Float32Array);
  expect(prepared.transfer).toContain(
    (terrain.positions as unknown as Float32Array).buffer,
  );
  expect(prepared.chunk.trees).toEqual(source.trees);
});

it('не создаёт буферы для пустой и частичной геометрии', () => {
  // Arrange
  const source = chunk();
  source.terrain = empty();
  source.facades = [empty()];

  // Act
  const prepared = prepareChunkTransfer(source);

  // Assert
  expect(prepared.chunk.terrain.positions).toHaveLength(0);
  expect(prepared.chunk.facades?.[0].positions).toHaveLength(0);
  expect(prepared.transfer).toHaveLength(0);
});

it.each([true, false])(
  'сохраняет полные нормали и восстанавливает неполные: %s',
  (complete) => {
    // Arrange
    const source = chunk();
    source.terrain.normals = complete ? [0, 1, 0, 0, 1, 0, 0, 1, 0] : [0, 1, 0];
    const expected: number[] = [];
    VertexData.ComputeNormals(
      source.terrain.positions,
      source.terrain.indices,
      expected,
    );
    // Act
    const actual = prepareChunkTransfer(source).chunk.terrain.normals!;
    // Assert
    expect(Array.from(actual)).toEqual(
      complete ? source.terrain.normals : expected,
    );
  },
);
