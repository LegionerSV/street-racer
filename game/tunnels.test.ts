import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { distance2 } from './geo';
import type { RegionData } from './types';

it.each([false, true])(
  'короткий тоннель уходит под землю до портала, со связными подходами: %s',
  (reverse) => {
    // Arrange
    const input: RegionData = {
      center: { lat: 0, lon: 0 },
      fetchedAt: 'test',
      drivingSide: 'right',
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      elements: [
        ...[-350, -30, 30, 350].map((x, i) => ({
          type: 'node' as const,
          id: i + 1,
          lat: 100 / 111320,
          lon: x / 111320,
        })),
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary' } },
        {
          type: 'way',
          id: 11,
          nodes: [2, 3],
          tags: { highway: 'primary', tunnel: 'yes', layer: '-1' },
        },
        { type: 'way', id: 12, nodes: [3, 4], tags: { highway: 'primary' } },
      ],
    };
    if (reverse) input.elements.reverse();
    // Act
    const world = buildWorld(input),
      tunnel = world.edges.find((e) => e.way === 11)!;
    // Assert
    expect(tunnel.points.every((p) => p.y + 5.7 < -0.5)).toBe(true);
    expect(world.edges.every((e) => !e.blocked)).toBe(true);
    for (const e of world.edges) {
      expect(e.points[0].y).toBeCloseTo(
        world.nodes.find((n) => n.id === e.from)!.y,
        7,
      );
      expect(e.points.at(-1)!.y).toBeCloseTo(
        world.nodes.find((n) => n.id === e.to)!.y,
        7,
      );
      for (let i = 1; i < e.points.length; i++)
        expect(
          Math.abs(e.points[i].y - e.points[i - 1].y) /
            distance2(e.points[i], e.points[i - 1]),
        ).toBeLessThan(0.081);
    }
    expect(world.nodes.find((n) => n.id === 1)!.y).toBeCloseTo(0.12);
    const chunk = buildChunk(world, '0,0', 0);
    expect(chunk.structures.positions.every(Number.isFinite)).toBe(true);
  },
);
