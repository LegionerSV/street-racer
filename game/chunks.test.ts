import { describe, it, expect } from 'vitest';
import { desiredChunks, ChunkBudget, buildChunk } from './chunks';
import type { World } from './types';

describe('Подготовка кварталов', () => {
  it('сохраняет ограниченный набор кварталов при длительной езде', () => {
    // Arrange
    const budget = new ChunkBudget(64);
    // Act
    for (let i = 0; i < 1000; i++) budget.touch(String(i), i);
    // Assert
    expect(budget.size).toBe(64); expect(budget.has('999')).toBe(true); expect(budget.has('0')).toBe(false);
  });
  it('подготавливает квартал под машиной и не выходит за пределы мира', () => {
    // Arrange / Act
    const result = desiredChunks({ x: 2490, y: 0, z: 2490 }, 0, 'high');
    // Assert
    expect(result.find(c => c.key === '9,9')?.lod).toBe(0);
    expect(result.every(c => { const [x, z] = c.key.split(',').map(Number); return x >= -10 && x < 10 && z >= -10 && z < 10; })).toBe(true);
  });
  it('генерирует совпадающие высоты на соседних границах', () => {
    // Arrange
    const w = { center: { lat: 0, lon: 0 }, nodes: [], edges: [], restrictions: [], buildings: [], areas: [], trees: [], elevation: { width: 2, size: 5600, values: new Float32Array([0, 20, 40, 60]) }, drivingSide: 'right', warnings: [], spawnEdge: -1, routes: [] } as World;
    // Act
    const a = buildChunk(w, '0,0', 0), b = buildChunk(w, '1,0', 0);
    const border = (positions: number[]) => { const list = []; for (let i = 0; i < positions.length; i += 3) if (positions[i] === 250) list.push([positions[i + 2], positions[i + 1]]); return list.sort((a, b) => a[0] - b[0]); };
    // Assert
    expect(border(a.terrain.positions)).toEqual(border(b.terrain.positions));
  });
  it('не создаёт горизонтальные ступени на наклонном дорожном полотне', () => {
    // Arrange
    const points = Array.from({ length: 11 }, (_, i) => ({ x: 100, y: i + .12, z: i * 10 }));
    const w = { center: { lat: 0, lon: 0 }, nodes: [], edges: [{ id: 0, way: 1, from: 1, to: 2, length: 101, width: 7, lanes: 2, speed: 14, name: 'Подъём', bridge: false, tunnel: false, layer: 0, points, blocked: false }], restrictions: [], buildings: [], areas: [], trees: [], elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', warnings: [], spawnEdge: 0, routes: [] } as World;
    // Act
    const road = buildChunk(w, '0,0', 0).road;
    // Assert
    for (let i = 0; i < road.positions.length; i += 3) expect(Math.abs(road.positions[i + 1] - (.12 + road.positions[i + 2] * .1))).toBeLessThan(.1);
  });
});
