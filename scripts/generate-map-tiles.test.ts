import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeTileArtifact } from '../game/tile-artifact';
import { generateMapTiles, type GeneratorEvent } from './generate-map-tiles';
import type { CommandRunner } from './local-map-data';

const decompress = promisify(brotliDecompress),
  execute = promisify(execFile),
  temporaryDirectories: string[] = [],
  firstTile = { z: 15, x: 19808, y: 10243 },
  secondTile = { z: 15, x: 19809, y: 10243 };

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'street-racer-tiles-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function fixtureFile(directory: string, includeSecond = true) {
  const path = join(directory, 'fixture.json'),
    tile = {
      osmTimestamp: '2026-09-10T08:30:00.000Z',
      drivingSide: 'right',
      elements: [
        { type: 'node', id: 1, lat: 55.75, lon: 37.61 },
        {
          type: 'way',
          id: 2,
          nodes: [1],
          tags: { highway: 'service', name: 'Тестовый проезд' },
        },
      ],
      elevation: { width: 2, values: [100, 101, 102, 103] },
    };
  await writeFile(
    path,
    JSON.stringify({
      tiles: {
        '15/19808/10243': tile,
        ...(includeSecond ? { '15/19809/10243': tile } : {}),
      },
    }),
    'utf8',
  );
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      }),
    ),
  );
});

it('dry-run выводит план прямоугольника и ничего не записывает', async () => {
  // Arrange
  const parent = await temporaryDirectory(),
    staging = join(parent, 'not-created'),
    events: GeneratorEvent[] = [];

  // Act
  const report = await generateMapTiles(
    {
      staging,
      dryRun: true,
      center: { lat: 55.751244, lon: 37.618423 },
      width: 2,
      height: 2,
      zoom: 15,
      concurrency: 2,
    },
    (event) => events.push(event),
  );

  // Assert
  expect(report).toMatchObject({ planned: 4, generated: 0, skipped: 0 });
  expect(events).toEqual([expect.objectContaining({ kind: 'plan', count: 4 })]);
  await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('dry-run объединяет прямоугольник с дополнительными клетками без дубликатов', async () => {
  // Arrange
  const parent = await temporaryDirectory(),
    staging = join(parent, 'not-created'),
    events: GeneratorEvent[] = [];

  // Act
  const report = await generateMapTiles(
    {
      staging,
      dryRun: true,
      center: { lat: 55.751244, lon: 37.618423 },
      width: 2,
      height: 2,
      zoom: 15,
      additionalTiles: [firstTile, { z: 15, x: 19814, y: 10243 }],
      concurrency: 2,
    },
    (event) => events.push(event),
  );

  // Assert
  expect(report).toMatchObject({ planned: 6, generated: 0, skipped: 0 });
  expect(events).toEqual([
    expect.objectContaining({
      kind: 'plan',
      count: 6,
      tiles: expect.arrayContaining(['15/19808/10243', '15/19814/10243']),
    }),
  ]);
  await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('реальный CLI-процесс выполняет dry-run без создания staging', async () => {
  // Arrange
  const parent = await temporaryDirectory(),
    staging = join(parent, 'cli-not-created'),
    script = join(process.cwd(), 'scripts', 'generate-map-tiles.ts');

  // Act
  const { stdout } = await execute(process.execPath, [
    '--experimental-transform-types',
    script,
    '--staging',
    staging,
    '--center',
    '55.751244,37.618423',
    '--width',
    '2',
    '--height',
    '2',
    '--extra-tile',
    '15/19814/10243',
    '--dry-run',
  ]);

  // Assert
  expect(stdout).toContain('"kind":"plan","count":5');
  expect(stdout).toContain('"planned": 5');
  await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('генерирует Brotli-артефакты из локального fixture и пропускает их повторно', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    staging = join(root, 'staging'),
    input = await fixtureFile(root),
    options = {
      staging,
      input,
      tiles: [firstTile, secondTile],
      concurrency: 2,
      generatedAt: '2026-09-11T10:00:00.000Z',
    };

  // Act
  const first = await generateMapTiles(options),
    second = await generateMapTiles(options),
    compressed = await readFile(
      join(staging, '15', '19808', '10243.tile.json.br'),
    ),
    artifact = decodeTileArtifact(
      new TextDecoder().decode(await decompress(compressed)),
      firstTile,
    );

  // Assert
  expect(first).toMatchObject({ planned: 2, generated: 2, skipped: 0 });
  expect(second).toMatchObject({ planned: 2, generated: 0, skipped: 2 });
  expect(first.failed).toEqual([]);
  expect(artifact.elements[1]?.tags?.name).toBe('Тестовый проезд');
  expect(artifact.elevation.values).toEqual(
    new Float32Array([100, 101, 102, 103]),
  );
  expect(
    JSON.parse(await readFile(join(staging, 'report.json'), 'utf8')),
  ).toMatchObject({ planned: 2, generated: 0, skipped: 2 });
  expect(
    JSON.parse(
      await readFile(join(staging, 'staging-manifest-v1.json'), 'utf8'),
    ),
  ).toMatchObject({
    schemaVersion: 1,
    tileSchemaVersion: 1,
    tileBuildVersion: artifact.tileBuildVersion,
    complete: true,
    planned: 2,
    tiles: {
      '15/19808/10243': {
        path: '15/19808/10243.tile.json.br',
        bytes: compressed.byteLength,
        checksum: artifact.checksum,
      },
    },
  });
});

it('не публикует тайл, превышающий зафиксированный лимит размера', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    staging = join(root, 'staging'),
    input = await fixtureFile(root, false);

  // Act
  const report = await generateMapTiles({
    staging,
    input,
    tiles: [firstTile],
    concurrency: 1,
    maxTileBytes: 1,
  });

  // Assert
  expect(report.generated).toBe(0);
  expect(report.failed).toEqual([
    {
      tile: '15/19808/10243',
      error: expect.stringMatching(/превышает лимит 1 Б/),
    },
  ]);
  await expect(
    stat(join(staging, '15', '19808', '10243.tile.json.br')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(
    JSON.parse(
      await readFile(join(staging, 'staging-manifest-v1.json'), 'utf8'),
    ),
  ).toMatchObject({ complete: false, planned: 1, tiles: {} });
});

it('пересобирает повреждённый файл и сохраняет ошибки отдельных тайлов', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    staging = join(root, 'staging'),
    input = await fixtureFile(root, false),
    options = {
      staging,
      input,
      tiles: [firstTile, secondTile],
      concurrency: 1,
      generatedAt: '2026-09-11T10:00:00.000Z',
    },
    events: GeneratorEvent[] = [];
  await generateMapTiles({ ...options, tiles: [firstTile] });
  const artifactPath = join(staging, '15', '19808', '10243.tile.json.br');
  await writeFile(artifactPath, 'повреждено', 'utf8');

  // Act
  const report = await generateMapTiles(options, (event) => events.push(event));

  // Assert
  expect(report.generated).toBe(1);
  expect(report.failed).toEqual([
    {
      tile: '15/19809/10243',
      error: 'В локальном input отсутствует source-тайл 15/19809/10243.',
    },
  ]);
  expect(events).toContainEqual(
    expect.objectContaining({ kind: 'generated', tile: '15/19808/10243' }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: 'failed',
      tile: '15/19809/10243',
    }),
  );
  const log = await readFile(join(staging, 'generation-log.ndjson'), 'utf8');
  expect(log).toContain('"kind":"generated"');
  expect(log).toContain('"kind":"failed"');
  expect(
    JSON.parse(
      await readFile(join(staging, 'staging-manifest-v1.json'), 'utf8'),
    ),
  ).toMatchObject({ complete: false, planned: 2 });
});

it('отклоняет junction, выводящий артефакт за пределы staging', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    staging = join(root, 'staging'),
    outside = join(root, 'outside'),
    input = await fixtureFile(root),
    report = vi.fn();
  await Promise.all([mkdir(staging), mkdir(outside)]);
  await symlink(outside, join(staging, '15'), 'junction');

  // Act / Assert
  await expect(
    generateMapTiles(
      {
        staging,
        input,
        tiles: [firstTile],
        concurrency: 1,
      },
      report,
    ),
  ).rejects.toThrow('Staging не должен содержать symlink или junction');
  await expect(
    stat(join(outside, '19808', '10243.tile.json.br')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(report).toHaveBeenCalledExactlyOnceWith({
    kind: 'plan',
    count: 1,
    tiles: ['15/19808/10243'],
  });
});

it('не запускает два генератора одновременно для одного staging', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    staging = join(root, 'staging'),
    input = await fixtureFile(root),
    lock = `${staging}.map-tile-generator.lock`;
  await writeFile(lock, `${process.pid}:другой-запуск\n`, 'utf8');

  // Act / Assert
  await expect(
    generateMapTiles({
      staging,
      input,
      tiles: [firstTile],
      concurrency: 1,
    }),
  ).rejects.toThrow(
    `Staging уже используется процессом ${process.pid}. Дождитесь завершения генерации.`,
  );
  expect(await readFile(lock, 'utf8')).toBe(`${process.pid}:другой-запуск\n`);
});

it('интеграционно генерирует fixture из PBF и локально кэшируемого DEM без Overpass', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    staging = join(root, 'staging'),
    pbf = join(root, 'region.osm.pbf'),
    demFixture = await readFile('game/fixtures/dem-12-2475-1280.png'),
    fetcher = vi.fn(async (url: string | URL | Request) => {
      const address =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      expect(address).toContain('/elevation-tiles-prod/terrarium/');
      return new Response(demFixture, { status: 200 });
    }),
    commands: string[][] = [],
    runner: CommandRunner = async (_executable, arguments_) => {
      commands.push(arguments_);
      const output = arguments_[arguments_.indexOf('-o') + 1];
      await writeFile(
        output,
        arguments_[0] === 'tags-filter'
          ? 'fixture-filtered-pbf'
          : '<osm><node id="1" lat="55.75" lon="37.61"/><way id="2"><nd ref="1"/><tag k="highway" v="service"/><tag k="name" v="Локальный проезд"/></way></osm>',
      );
    };
  await writeFile(pbf, 'fixture-pbf');

  const options = {
    staging,
    pbf,
    osmCache: join(root, 'osm-cache'),
    demCache: join(root, 'dem-cache'),
    osmTimestamp: '2026-09-01T00:00:00Z',
    inputSource: 'Локальный тестовый extract',
    inputLicense: 'ODbL-1.0',
    demTimestamp: '2026-08-01T00:00:00Z',
    demLicense: 'Tilezen data source licences and attribution',
    drivingSide: 'right' as const,
    downloadDem: true,
    commandRunner: runner,
    demFetcher: fetcher,
    tiles: [firstTile],
    concurrency: 1,
    elevationWidth: 2,
    generatedAt: '2026-09-11T10:00:00Z',
  };

  // Act
  const report = await generateMapTiles(options),
    changedInput = await generateMapTiles({
      ...options,
      demLicense: 'Обновлённая лицензия fixture DEM',
    });
  const compressed = await readFile(
      join(staging, '15', '19808', '10243.tile.json.br'),
    ),
    artifact = decodeTileArtifact(
      new TextDecoder().decode(await decompress(compressed)),
      firstTile,
    );

  // Assert
  expect(report).toMatchObject({ generated: 1, failed: [] });
  expect(changedInput).toMatchObject({ generated: 1, skipped: 0, failed: [] });
  expect(commands.map((arguments_) => arguments_[0])).toEqual([
    'tags-filter',
    'extract',
  ]);
  expect(artifact.bufferedBounds.south).toBeLessThan(artifact.coreBounds.south);
  expect(
    artifact.elements.find((element) => element.type === 'way'),
  ).toMatchObject({
    nodes: [1],
    tags: { highway: 'service', name: 'Локальный проезд' },
  });
  expect(artifact.osmTimestamp).toBe('2026-09-01T00:00:00.000Z');
  expect(
    JSON.parse(await readFile(join(staging, 'input-data.json'), 'utf8')),
  ).toMatchObject({
    osm: {
      file: 'region.osm.pbf',
      source: 'Локальный тестовый extract',
      license: 'ODbL-1.0',
    },
    dem: { license: 'Обновлённая лицензия fixture DEM' },
  });
});
