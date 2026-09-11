import { describe, expect, it, vi } from 'vitest';
import {
  CompositeTileSource,
  IndexedDbTileSource,
  OverpassTileSource,
  S3TileSource,
  StaticTileSource,
  type TileLoadResult,
  type TileSource,
} from './tile-source';
import { sourceTileBounds } from './source-tiles';
import type { LoadingLog } from './loading-log';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  encodeTileArtifact,
  type TileArtifactV1Input,
} from './tile-artifact';

type TestTile = { value: string };

function source(
  name: string,
  load: (id: string, signal: AbortSignal) => Promise<TileLoadResult<TestTile>>,
  save?: (id: string, tile: TestTile, signal: AbortSignal) => Promise<void>,
): TileSource<TestTile, string> {
  return { name, load: vi.fn(load), save: save && vi.fn(save) };
}

describe('CompositeTileSource', () => {
  it('останавливается на IndexedDB hit и не вызывает следующие источники', async () => {
    // Arrange
    const cached = source('indexeddb', async () => ({
        kind: 'hit',
        source: 'indexeddb',
        tile: { value: 'cache' },
      })),
      remote = source('static', async () => ({
        kind: 'missing',
        source: 'static',
      })),
      fallback = source('overpass-dem', async () => ({
        kind: 'hit',
        source: 'overpass-dem',
        tile: { value: 'fallback' },
      }));

    // Act
    const result = await new CompositeTileSource([
      cached,
      remote,
      fallback,
    ]).load('15/1/2', new AbortController().signal);

    // Assert
    expect(result).toEqual({
      kind: 'hit',
      source: 'indexeddb',
      tile: { value: 'cache' },
    });
    expect(cached.load).toHaveBeenCalledTimes(1);
    expect(remote.load).not.toHaveBeenCalled();
    expect(fallback.load).not.toHaveBeenCalled();
  });

  it.each(['missing', 'corrupt', 'incompatible'] as const)(
    'после результата %s удалённого источника вызывает fallback и сохраняет hit в IndexedDB',
    async (kind) => {
      // Arrange
      const order: string[] = [],
        save = vi.fn(async () => {
          order.push('save');
        }),
        cached = source(
          'indexeddb',
          async () => {
            order.push('indexeddb');
            return { kind: 'missing', source: 'indexeddb' };
          },
          save,
        ),
        remote = source('static', async () => {
          order.push('static');
          return { kind, source: 'static', error: `remote ${kind}` };
        }),
        fallback = source('overpass-dem', async () => {
          order.push('overpass-dem');
          return {
            kind: 'hit',
            source: 'overpass-dem',
            tile: { value: 'built' },
          };
        });

      // Act
      const result = await new CompositeTileSource([
        cached,
        remote,
        fallback,
      ]).load('15/1/2', new AbortController().signal);

      // Assert
      expect(result).toEqual({
        kind: 'hit',
        source: 'overpass-dem',
        tile: { value: 'built' },
      });
      expect(order).toEqual(['indexeddb', 'static', 'overpass-dem', 'save']);
      expect(cached.load).toHaveBeenCalledTimes(1);
      expect(remote.load).toHaveBeenCalledTimes(1);
      expect(fallback.load).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(
        '15/1/2',
        { value: 'built' },
        expect.any(AbortSignal),
        'overpass-dem',
      );
    },
  );

  it('temporary failure удалённого источника не блокирует fallback', async () => {
    // Arrange
    const cached = source('indexeddb', async () => ({
        kind: 'missing',
        source: 'indexeddb',
      })),
      remote = source('static', async () => ({
        kind: 'temporary-failure',
        source: 'static',
        error: 'HTTP 503',
      })),
      fallback = source('overpass-dem', async () => ({
        kind: 'hit',
        source: 'overpass-dem',
        tile: { value: 'built' },
      }));

    // Act
    const result = await new CompositeTileSource([
      cached,
      remote,
      fallback,
    ]).load('15/1/2', new AbortController().signal);

    // Assert
    expect(result.kind).toBe('hit');
    expect(fallback.load).toHaveBeenCalledTimes(1);
  });

  it('передаёт в диагностику источник и точную причину fallback', async () => {
    // Arrange
    const remote = source('s3', async () => ({
        kind: 'temporary-failure',
        source: 's3',
        error: 'S3 GET: HTTP 503.',
      })),
      fallback = source('overpass-dem', async () => ({
        kind: 'hit',
        source: 'overpass-dem',
        tile: { value: 'built' },
      })),
      observe = vi.fn();

    // Act
    await new CompositeTileSource(
      [remote, fallback],
      undefined,
      undefined,
      observe,
    ).load('15/1/2', new AbortController().signal);

    // Assert
    expect(observe).toHaveBeenNthCalledWith(1, '15/1/2', {
      kind: 'temporary-failure',
      source: 's3',
      error: 'S3 GET: HTTP 503.',
    });
    expect(observe).toHaveBeenNthCalledWith(2, '15/1/2', {
      kind: 'hit',
      source: 'overpass-dem',
      tile: { value: 'built' },
    });
  });

  it('aborted немедленно завершает цепочку', async () => {
    // Arrange
    const cached = source('indexeddb', async () => ({
        kind: 'missing',
        source: 'indexeddb',
      })),
      remote = source('static', async () => ({
        kind: 'aborted',
        source: 'static',
        error: 'Отменено',
      })),
      fallback = source('overpass-dem', async () => ({
        kind: 'hit',
        source: 'overpass-dem',
        tile: { value: 'built' },
      }));

    // Act
    const result = await new CompositeTileSource([
      cached,
      remote,
      fallback,
    ]).load('15/1/2', new AbortController().signal);

    // Assert
    expect(result).toEqual({
      kind: 'aborted',
      source: 'static',
      error: 'Отменено',
    });
    expect(fallback.load).not.toHaveBeenCalled();
  });

  it('объединяет параллельные запросы одного tile ID в одну загрузку', async () => {
    // Arrange
    let release!: () => void;
    const fallback = source('overpass-dem', async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return {
          kind: 'hit',
          source: 'overpass-dem',
          tile: { value: 'built' },
        };
      }),
      composite = new CompositeTileSource([fallback]),
      signal = new AbortController().signal;

    // Act
    const first = composite.load('15/1/2', signal),
      second = composite.load('15/1/2', signal);
    await vi.waitFor(() => expect(fallback.load).toHaveBeenCalledTimes(1));
    release();

    // Assert
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'hit', source: 'overpass-dem', tile: { value: 'built' } },
      { kind: 'hit', source: 'overpass-dem', tile: { value: 'built' } },
    ]);
    expect(fallback.load).toHaveBeenCalledTimes(1);
  });

  it('отмена одного подписчика не отменяет общую загрузку для второго', async () => {
    // Arrange
    let release!: () => void;
    const fallback = source('overpass-dem', async (_id, signal) => {
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return {
          kind: 'hit',
          source: 'overpass-dem',
          tile: { value: 'built' },
        };
      }),
      composite = new CompositeTileSource([fallback]),
      firstControl = new AbortController(),
      secondControl = new AbortController();

    // Act
    const first = composite.load('15/1/2', firstControl.signal),
      second = composite.load('15/1/2', secondControl.signal);
    firstControl.abort(new Error('Первый запрос отменён.'));
    const firstResult = await first;
    release();

    // Assert
    expect(firstResult).toEqual({
      kind: 'aborted',
      source: 'composite',
      error: 'Первый запрос отменён.',
    });
    await expect(second).resolves.toEqual({
      kind: 'hit',
      source: 'overpass-dem',
      tile: { value: 'built' },
    });
    expect(fallback.load).toHaveBeenCalledTimes(1);
  });

  it('отменяет общую загрузку после отмены всех подписчиков', async () => {
    // Arrange
    let sharedSignal: AbortSignal | undefined;
    const fallback = source('overpass-dem', async (_id, signal) => {
        sharedSignal = signal;
        return new Promise((resolve) =>
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                kind: 'aborted',
                source: 'overpass-dem',
                error: 'Общая загрузка отменена.',
              }),
            { once: true },
          ),
        );
      }),
      composite = new CompositeTileSource([fallback]),
      firstControl = new AbortController(),
      secondControl = new AbortController();

    // Act
    const first = composite.load('15/1/2', firstControl.signal),
      second = composite.load('15/1/2', secondControl.signal);
    firstControl.abort();
    secondControl.abort();

    // Assert
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { kind: 'aborted', source: 'composite' },
      { kind: 'aborted', source: 'composite' },
    ]);
    await vi.waitFor(() => {
      expect(fallback.load).toHaveBeenCalledTimes(1);
      expect(sharedSignal?.aborted).toBe(true);
    });
  });

  it('дедуплицирует одинаковый XYZ независимо от порядка полей объекта', async () => {
    // Arrange
    let release!: () => void;
    const fallback: TileSource<TestTile> = {
        name: 'overpass-dem',
        load: vi.fn(async (): Promise<TileLoadResult<TestTile>> => {
          await new Promise<void>((resolve) => (release = resolve));
          return {
            kind: 'hit',
            source: 'overpass-dem',
            tile: { value: 'built' },
          };
        }),
      },
      composite = new CompositeTileSource([fallback]),
      signal = new AbortController().signal;

    // Act
    const first = composite.load({ z: 15, x: 1, y: 2 }, signal),
      second = composite.load({ x: 1, y: 2, z: 15 }, signal);
    await vi.waitFor(() => expect(fallback.load).toHaveBeenCalledTimes(1));
    release();

    // Assert
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fallback.load).toHaveBeenCalledTimes(1);
  });
});

const artifactId = { z: 15, x: 19808, y: 10243 } as const;

function artifact(): TileArtifactV1Input {
  const coreBounds = sourceTileBounds(artifactId);
  return {
    schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
    tileBuildVersion: TILE_BUILD_VERSION,
    ...artifactId,
    coreBounds,
    bufferedBounds: {
      south: coreBounds.south - 0.003,
      west: coreBounds.west - 0.005,
      north: coreBounds.north + 0.003,
      east: coreBounds.east + 0.005,
    },
    generatedAt: '2026-09-10T00:00:00.000Z',
    osmTimestamp: '2026-09-09T00:00:00Z',
    drivingSide: 'right',
    elements: [{ type: 'node', id: 42, lat: 55.75, lon: 37.61 }],
    elevation: {
      width: 2,
      size: 690,
      values: new Float32Array([1, 2, 3, 4]),
    },
  };
}

describe('источники TileArtifactV1', () => {
  function catalog(
    tileChecksum = JSON.parse(encodeTileArtifact(artifact())).checksum,
  ) {
    return {
      schemaVersion: 1,
      generatedAt: '2026-09-10T01:00:00.000Z',
      activeDatasets: ['moscow-2026-09-10'],
      datasets: [
        {
          datasetId: 'moscow-2026-09-10',
          schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
          tileBuildVersion: TILE_BUILD_VERSION,
          path: 'maps/v1/2026-09-09-source-tile-1/moscow-2026-09-10',
          tiles: {
            '15/19808/10243': {
              bytes: 1234,
              checksum: tileChecksum,
            },
          },
        },
      ],
    };
  }

  it('не выполняет S3-запросы без базового URL', async () => {
    // Arrange
    const request = vi.fn();

    // Act
    const result = await new S3TileSource({ fetch: request }).load(
      artifactId,
      new AbortController().signal,
    );

    // Assert
    expect(result).toEqual({
      kind: 'missing',
      source: 's3',
      error: 'S3 source-тайлы отключены: VITE_MAP_TILE_BASE_URL не задан.',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('не начинает чтение каталога для уже отменённого запроса', async () => {
    // Arrange
    const request = vi.fn(),
      control = new AbortController();
    control.abort(new Error('Запрос отменён.'));

    // Act
    const result = await new S3TileSource({
      baseUrl: 'https://maps.example',
      fetch: request,
    }).load(artifactId, control.signal);

    // Assert
    expect(result).toEqual({
      kind: 'aborted',
      source: 's3',
      error: 'Запрос отменён.',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    'maps/%2e%2e/secret',
    'maps/base/..\\secret',
    'maps/base/tile?token=secret',
    'maps/base/tile#fragment',
  ])('отклоняет небезопасный путь dataset: %s', async (path) => {
    // Arrange
    const unsafeCatalog = catalog();
    unsafeCatalog.datasets[0].path = path;
    const request = vi.fn(
        async () => new Response(JSON.stringify(unsafeCatalog)),
      ),
      source = new S3TileSource({
        baseUrl: 'https://maps.example/public-prefix',
        fetch: request,
      });

    // Act
    const result = await source.load(artifactId, new AbortController().signal);

    // Assert
    expect(result).toMatchObject({ kind: 'corrupt', source: 's3' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('кэширует каталог и не запрашивает тайл, которого в нём нет', async () => {
    // Arrange
    const request = vi.fn(async (url: string) => {
      expect(url).toBe('https://maps.example/maps/catalog-v1.json');
      return new Response(JSON.stringify(catalog()));
    });
    const source = new S3TileSource({
      baseUrl: 'https://maps.example/',
      fetch: request,
    });

    // Act
    const first = await source.load(
      { ...artifactId, x: artifactId.x + 1 },
      new AbortController().signal,
    );
    const second = await source.load(
      { ...artifactId, y: artifactId.y + 1 },
      new AbortController().signal,
    );

    // Assert
    expect(first.kind).toBe('missing');
    expect(second.kind).toBe('missing');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('использует один каталог после безопасного пересоздания цепочки в той же сессии', async () => {
    // Arrange
    const catalogCache = new Map(),
      request = vi.fn(async () => new Response(JSON.stringify(catalog()))),
      options = {
        baseUrl: 'https://maps.example',
        fetch: request,
        catalogCache,
      };

    // Act
    await new S3TileSource(options).load(
      { ...artifactId, x: artifactId.x + 1 },
      new AbortController().signal,
    );
    await new S3TileSource(options).load(
      { ...artifactId, y: artifactId.y + 1 },
      new AbortController().signal,
    );

    // Assert
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('не кэширует ошибку каталога и безопасно повторяет его чтение', async () => {
    // Arrange
    const request = vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(catalog()))),
      source = new S3TileSource({
        baseUrl: 'https://maps.example',
        fetch: request,
      }),
      missingId = { ...artifactId, x: artifactId.x + 1 };

    // Act
    const failed = await source.load(missingId, new AbortController().signal),
      retried = await source.load(missingId, new AbortController().signal);

    // Assert
    expect(failed).toMatchObject({
      kind: 'temporary-failure',
      error: 'Каталог S3 недоступен: HTTP 503.',
    });
    expect(retried.kind).toBe('missing');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('при S3 hit делает GET без HEAD, проверяет артефакт и не вызывает fallback', async () => {
    // Arrange
    const encoded = encodeTileArtifact(artifact()),
      endLogEntry = vi.fn(),
      startLogEntry = vi.fn(() => endLogEntry),
      log = {
        start: startLogEntry,
      } as unknown as LoadingLog,
      store = { get: vi.fn(async () => undefined), put: vi.fn(async () => {}) },
      request = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(catalog())))
        .mockResolvedValueOnce(new Response(encoded)),
      cache = new IndexedDbTileSource(store),
      remote = new S3TileSource({
        baseUrl: 'https://maps.example',
        fetch: request,
      }),
      build = vi.fn(async () => artifact()),
      fallback = new OverpassTileSource(build);

    // Act
    const result = await new CompositeTileSource(
      [cache, remote, fallback],
      undefined,
      log,
    ).load(artifactId, new AbortController().signal);

    // Assert
    expect(result.kind).toBe('hit');
    expect(result.source).toBe('s3');
    expect(request).toHaveBeenNthCalledWith(
      2,
      'https://maps.example/maps/v1/2026-09-09-source-tile-1/moscow-2026-09-10/15/19808/10243.tile.json.br',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(
      request.mock.calls.every(([, init]) => init?.method !== 'HEAD'),
    ).toBe(true);
    expect(build).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      timings: {
        fetchMs: expect.any(Number),
        decodeMs: expect.any(Number),
      },
    });
    expect(startLogEntry).toHaveBeenCalledWith('Сохранение source-тайла', {
      tile: '15/19808/10243',
      source: 'indexeddb',
    });
    expect(endLogEntry).toHaveBeenCalledWith('success');
  });

  it.each([
    ['temporary-failure', new TypeError('Failed to fetch')],
    ['incompatible', { ...catalog(), schemaVersion: 2 }],
  ] as const)(
    'диагностирует S3 %s и передаёт управление fallback',
    async (kind, value) => {
      // Arrange
      const request = vi.fn(async () => {
          if (value instanceof Error) throw value;
          return new Response(JSON.stringify(value));
        }),
        remote = new S3TileSource({
          baseUrl: 'https://maps.example',
          fetch: request,
        });

      // Act
      const result = await remote.load(
        artifactId,
        new AbortController().signal,
      );

      // Assert
      expect(result.kind).toBe(kind);
      if (result.kind !== 'hit') expect(result.error).toBeTruthy();
    },
  );

  it('отклоняет тайл с checksum, не совпадающим с каталогом', async () => {
    // Arrange
    const request = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(catalog('crc32:00000000'))),
        )
        .mockResolvedValueOnce(new Response(encodeTileArtifact(artifact()))),
      remote = new S3TileSource({
        baseUrl: 'https://maps.example',
        fetch: request,
      });

    // Act
    const result = await remote.load(artifactId, new AbortController().signal);

    // Assert
    expect(result.kind).toBe('corrupt');
    if (result.kind !== 'hit')
      expect(result.error).toBe(
        'Контрольная сумма source-тайла 15/19808/10243 не совпадает с каталогом S3.',
      );
  });

  it.each([
    ['incompatible', { schemaVersion: 2 }],
    ['corrupt', { checksum: 'crc32:00000000' }],
  ] as const)('типизирует %s запись IndexedDB', async (kind, patch) => {
    // Arrange
    const payload = { ...JSON.parse(encodeTileArtifact(artifact())), ...patch },
      store = {
        get: vi.fn(async () => ({
          serialized: JSON.stringify(payload),
          savedAt: Date.now(),
        })),
        put: vi.fn(),
      };

    // Act
    const result = await new IndexedDbTileSource(store).load(
      artifactId,
      new AbortController().signal,
    );

    // Assert
    expect(result.kind).toBe(kind);
    expect(store.get).toHaveBeenCalledWith('source-tile:1:15/19808/10243');
  });

  it('fallback создаёт валидный артефакт, сохраняет его и повторно читает из IndexedDB', async () => {
    // Arrange
    const data = new Map<string, { serialized: string; savedAt: number }>(),
      store = {
        get: vi.fn(async (key: string) => data.get(key)),
        put: vi.fn(
          async (
            key: string,
            value: { serialized: string; savedAt: number },
          ) => {
            data.set(key, value);
          },
        ),
      },
      build = vi.fn(async () => artifact()),
      composite = new CompositeTileSource([
        new IndexedDbTileSource(store),
        new StaticTileSource(),
        new OverpassTileSource(build),
      ]),
      signal = new AbortController().signal;

    // Act
    const built = await composite.load(artifactId, signal),
      cached = await composite.load(artifactId, signal);

    // Assert
    expect(built.kind).toBe('hit');
    expect(built.source).toBe('overpass-dem');
    expect(cached.kind).toBe('hit');
    expect(cached.source).toBe('indexeddb');
    expect(build).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
    if (cached.kind === 'hit') {
      expect(cached.tile.elements).toEqual(artifact().elements);
      expect([...cached.tile.elevation.values]).toEqual([1, 2, 3, 4]);
      expect(cached.tile.checksum).toMatch(/^crc32:[0-9a-f]{8}$/);
    }
  });

  it('не продлевает почти семидневный OSM-кэш ещё на семь дней', async () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-10T00:00:00.000Z');
    const data = new Map<string, { serialized: string; savedAt: number }>(),
      store = {
        get: vi.fn(async (key: string) => data.get(key)),
        put: vi.fn(
          async (
            key: string,
            value: { serialized: string; savedAt: number },
          ) => {
            data.set(key, value);
          },
        ),
      },
      oldArtifact = () => ({
        ...artifact(),
        osmTimestamp: '2026-09-03T01:00:00.000Z',
      }),
      build = vi.fn(async () => oldArtifact()),
      composite = new CompositeTileSource([
        new IndexedDbTileSource(store),
        new OverpassTileSource(build),
      ]),
      signal = new AbortController().signal;

    try {
      // Act
      await composite.load(artifactId, signal);
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await composite.load(artifactId, signal);

      // Assert
      expect(build).toHaveBeenCalledTimes(2);
      expect(store.put.mock.calls[0][1].savedAt).toBe(
        Date.parse('2026-09-03T01:00:00.000Z'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
