import { afterEach, expect, it, vi } from 'vitest';
import { raceGrid } from './fixtures/race-grid';
import type { WorkerRequest, WorkerResponse } from './types';
import { edgeById } from './road-graph';
afterEach(() => vi.unstubAllGlobals());
it('строит гонку по активной карте и включает новую территорию только после commit', async () => {
  // Arrange
  const responses: WorkerResponse[] = [];
  const surface = {
    onmessage: undefined as ((e: { data: WorkerRequest }) => void) | undefined,
    postMessage: (r: WorkerResponse) => responses.push(r),
  };
  vi.stubGlobal('self', surface);
  await import('./world.worker');
  const call = (data: WorkerRequest) => {
    surface.onmessage!({ data });
    return responses.at(-1)!;
  };
  const first = call({ type: 'world', id: 1, region: raceGrid() });
  if (first.type !== 'world') throw new Error('Не построен мир');
  const edge = edgeById(
    first.world,
    first.world.routes.find((r) => r.kind === 'sprint')!.edges[0],
  )!;
  const start = edge.stableId;
  // Act
  call({ type: 'prepare', id: 2, region: raceGrid(4, 3) });
  const before = call({ type: 'race', id: 3, start, kind: 'sprint' });
  call({ type: 'commit', id: 4 });
  const after = call({ type: 'race', id: 5, start, kind: 'sprint' });
  // Assert
  expect(before.type).toBe('race');
  expect(after.type).toBe('race');
  if (before.type === 'race' && after.type === 'race') {
    expect(before.route).not.toBeNull();
    expect(after.route).not.toBeNull();
    expect(before.route!.points.every((p) => p.x < 2000 && p.z < 2000)).toBe(
      true,
    );
    expect(after.route!.points.some((p) => p.x > 2000 || p.z > 2000)).toBe(
      true,
    );
    expect(after.route!.length).toBeGreaterThan(before.route!.length);
  }
});
