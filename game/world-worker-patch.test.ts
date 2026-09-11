import { afterEach, expect, it, vi } from 'vitest';
import type {
  OSMElement,
  RegionData,
  SourceTileData,
  WorkerRequest,
  WorkerResponse,
} from './types';

afterEach(() => vi.unstubAllGlobals());

const elevation = { width: 2, size: 1000, values: new Float32Array(4) };
const road = (id: number, lon: number): OSMElement[] => [
  { type: 'node', id: id * 10, lat: -0.001, lon },
  { type: 'node', id: id * 10 + 1, lat: -0.002, lon },
  {
    type: 'way',
    id,
    nodes: [id * 10, id * 10 + 1],
    tags: { highway: 'residential' },
  },
];
const tile = (key: string, elements: OSMElement[]): SourceTileData => ({
  key,
  elements,
  elevation,
  checksum: key,
});
const region = (sourceTiles: SourceTileData[]): RegionData => ({
  center: { lat: 0, lon: 0 },
  sourceTiles,
  loadedTiles: sourceTiles.map((entry) => entry.key),
  elements: sourceTiles.flatMap((entry) => entry.elements),
  elevation: {
    ...elevation,
    patches: sourceTiles.map((entry) => entry.elevation),
  },
  drivingSide: 'right',
  fetchedAt: 'test',
  heightDatum: 0,
});

it('готовит WorldPatch отдельно от активного мира и не коммитит ошибочный prepare', async () => {
  // Arrange
  const responses: WorkerResponse[] = [],
    surface = {
      onmessage: undefined as
        | ((event: { data: WorkerRequest }) => void)
        | undefined,
      postMessage: (response: WorkerResponse) => responses.push(response),
    },
    firstTile = tile('15/16384/16384', road(10, 0.001)),
    secondTile = tile('15/16385/16384', road(20, 0.012));
  vi.stubGlobal('self', surface);
  await import('./world.worker');
  const call = (request: WorkerRequest) => {
    surface.onmessage!({ data: request });
    return responses.at(-1)!;
  };
  call({ id: 1, type: 'world', region: region([firstTile]) });
  const before = call({ id: 2, type: 'chunk', key: '0,-1', lod: 0 });
  // Act
  const prepared = call({
    id: 3,
    type: 'prepareTiles',
    update: {
      add: [secondTile],
      remove: [],
      center: { lat: 0, lon: 0 },
      drivingSide: 'right',
      fetchedAt: 'test',
      heightDatum: 0,
    },
  });
  const during = call({ id: 4, type: 'chunk', key: '0,-1', lod: 0 });
  const failed = call({
    id: 5,
    type: 'prepare',
    region: {
      ...region([firstTile]),
      sourceTiles: [{ ...firstTile, key: 'bad' }],
    },
  });
  const commit = call({ id: 6, type: 'commit' });
  // Assert
  expect(prepared.type).toBe('prepared');
  if (prepared.type === 'prepared') {
    expect(prepared.prepared.patch.coverageAdded).toEqual([secondTile.key]);
    expect(
      prepared.prepared.patch.edgesAddedOrUpdated.some(
        (edge) => edge.way === 20,
      ),
    ).toBe(true);
    expect(prepared.prepared.patch.dirtyChunks.length).toBeGreaterThan(0);
  }
  expect(before.type).toBe('chunk');
  expect(during.type).toBe('chunk');
  if (before.type === 'chunk' && during.type === 'chunk')
    expect(during.chunk).toBe(before.chunk);
  expect(failed).toEqual(
    expect.objectContaining({
      type: 'error',
      error: expect.stringContaining('Некорректный ключ'),
    }),
  );
  expect(commit).toEqual(
    expect.objectContaining({
      type: 'error',
      error: 'Новая часть района ещё не подготовлена.',
    }),
  );
});
