import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { toGeo } from '../game/geo';
import { mapCellQuery } from '../game/map-source';
import {
  createDemElevationSource,
  createPbfMapSource,
  OSMIUM_FILTER_EXPRESSIONS,
  parseOsmXml,
  type CommandRunner,
} from './local-map-data';

const temporaryDirectories: string[] = [];
const execute = promisify(execFile);
const osmiumAvailable = await execute('osmium', ['--version'])
  .then(() => true)
  .catch(() => false);

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'street-racer-local-map-'));
  temporaryDirectories.push(directory);
  return directory;
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

it('парсит OSM XML с полными зависимостями и пользовательскими тегами', () => {
  // Arrange
  const xml = `<?xml version="1.0"?><osm>
    <node id="1" lat="55.7" lon="37.6"><tag k="name" v="А &amp; Б"/></node>
    <node id="2" lat="55.8" lon="37.7"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/></way>
    <relation id="20"><member type="way" ref="10" role="from"/><member type="node" ref="2" role="via"/><tag k="type" v="restriction"/></relation>
  </osm>`;

  // Act
  const elements = parseOsmXml(xml);

  // Assert
  expect(elements).toEqual([
    { type: 'node', id: 1, lat: 55.7, lon: 37.6, tags: { name: 'А & Б' } },
    { type: 'node', id: 2, lat: 55.8, lon: 37.7 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'service' } },
    {
      type: 'relation',
      id: 20,
      members: [
        { type: 'way', ref: 10, role: 'from' },
        { type: 'node', ref: 2, role: 'via' },
      ],
      tags: { type: 'restriction' },
    },
  ]);
});

it('держит osmium-фильтры эквивалентными категориям игрового Overpass-запроса', () => {
  // Arrange
  const query = mapCellQuery({
    south: 55.6,
    west: 37.5,
    north: 55.8,
    east: 37.7,
  });

  // Act
  const filters = OSMIUM_FILTER_EXPRESSIONS.join('\n');

  // Assert
  expect(filters).toContain('motorway_link');
  expect(filters).toContain('living_street');
  expect(filters).toContain('n/highway=traffic_signals');
  expect(filters).toContain('r/type=restriction');
  for (const category of [
    'building',
    'building:part',
    'natural=water,wood,tree',
    'waterway=riverbank',
    'landuse=forest,grass,meadow,reservoir',
    'leisure=park',
  ]) {
    expect(filters).toContain(category);
    expect(query).toContain(category.split('=')[0]);
  }
});

it('фильтрует регион один раз, извлекает smart bbox и повторно читает кэш', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    pbf = join(root, 'region.osm.pbf'),
    cache = join(root, 'osm-cache'),
    calls: string[][] = [],
    runner: CommandRunner = async (_executable, arguments_) => {
      calls.push(arguments_);
      const output = arguments_[arguments_.indexOf('-o') + 1];
      await writeFile(
        output,
        arguments_[0] === 'tags-filter'
          ? 'filtered-pbf'
          : '<osm><node id="1" lat="55.7" lon="37.6"/><way id="2"><nd ref="1"/><tag k="highway" v="service"/></way></osm>',
      );
    };
  await writeFile(pbf, 'fixture-pbf');
  const source = await createPbfMapSource(
    {
      pbf,
      cache,
      osmTimestamp: '2026-09-01T00:00:00Z',
      osmiumPath: 'osmium-fixture',
    },
    new AbortController().signal,
    runner,
  );
  const bounds = { south: 55.6, west: 37.5, north: 55.8, east: 37.7 };

  // Act
  const first = await source.load(bounds),
    second = await source.load(bounds);

  // Assert
  expect(first).toEqual(second);
  expect(
    first.elements.map((element) => `${element.type}/${element.id}`),
  ).toEqual(['node/1', 'way/2']);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(
    expect.arrayContaining(['tags-filter', pbf, ...OSMIUM_FILTER_EXPRESSIONS]),
  );
  expect(calls[1]).toEqual(
    expect.arrayContaining([
      'extract',
      '--bbox',
      '37.5000000,55.6000000,37.7000000,55.8000000',
      '--strategy',
      'smart',
      '--option',
      'types=any',
    ]),
  );
});

it('инвалидирует extract-кэш после изменения исходной PBF', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    pbf = join(root, 'region.osm.pbf'),
    cache = join(root, 'osm-cache'),
    outputs: string[] = [],
    runner: CommandRunner = async (_executable, arguments_) => {
      const output = arguments_[arguments_.indexOf('-o') + 1];
      outputs.push(output);
      await writeFile(
        output,
        arguments_[0] === 'tags-filter'
          ? 'filtered-pbf'
          : '<osm><node id="1" lat="55.7" lon="37.6"/></osm>',
      );
    },
    options = {
      pbf,
      cache,
      osmTimestamp: '2026-09-01T00:00:00Z',
    },
    bounds = { south: 55.6, west: 37.5, north: 55.8, east: 37.7 };
  await writeFile(pbf, 'first-pbf');
  const first = await createPbfMapSource(
    options,
    new AbortController().signal,
    runner,
  );
  await first.load(bounds);

  // Act
  await writeFile(pbf, 'second-pbf-with-another-size');
  const second = await createPbfMapSource(
    options,
    new AbortController().signal,
    runner,
  );
  await second.load(bounds);

  // Assert
  expect(outputs).toHaveLength(4);
  expect(outputs[0]).not.toBe(outputs[2]);
  expect(outputs[1]).not.toBe(outputs[3]);
  expect(first.fingerprint).not.toBe(second.fingerprint);
});

it.runIf(osmiumAvailable)(
  'настоящий osmium сохраняет crossing way, relation и все их зависимости',
  async () => {
    // Arrange
    const root = await temporaryDirectory(),
      pbf = join(root, 'fixture.osm.pbf');
    await execute('osmium', [
      'cat',
      join(process.cwd(), 'scripts', 'fixtures', 'map-equivalence.osm'),
      '--output',
      pbf,
    ]);
    const source = await createPbfMapSource(
      {
        pbf,
        cache: join(root, 'cache'),
        osmTimestamp: '2026-09-01T00:00:00Z',
      },
      new AbortController().signal,
    );

    // Act
    const result = await source.load({
      south: 55.744,
      west: 37.595,
      north: 55.758,
      east: 37.61,
    });

    // Assert
    expect(
      result.elements.map((element) => `${element.type}/${element.id}`),
    ).toEqual(
      expect.arrayContaining([
        'node/1',
        'node/2',
        'node/3',
        'node/4',
        'way/100',
        'way/101',
        'way/102',
        'relation/200',
      ]),
    );
    expect(
      result.elements.find((element) => element.type === 'relation')?.members,
    ).toHaveLength(3);
  },
);

it('переиспользует глобальные DEM-тайлы и даёт одинаковую высоту на общем шве', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    fixtures = new Map<string, Buffer>(
      await Promise.all(
        [2475, 2476].flatMap((x) =>
          [1280, 1281].map(
            async (y) =>
              [
                `${x}/${y}`,
                await readFile(`game/fixtures/dem-12-${x}-${y}.png`),
              ] as const,
          ),
        ),
      ),
    ),
    fetcher = vi.fn(async (url: string | URL | Request) => {
      const address =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        match = address.match(/\/12\/(\d+)\/(\d+)\.png$/),
        fixture = match && fixtures.get(`${match[1]}/${match[2]}`);
      if (!fixture) return new Response('', { status: 404 });
      return new Response(new Uint8Array(fixture), { status: 200 });
    }),
    elevation = createDemElevationSource({
      cache: join(root, 'dem-cache'),
      downloadMissing: true,
      fetcher,
    }),
    boundary = { lat: 55.75, lon: (2476 / 2 ** 12) * 360 - 180 },
    firstCenter = toGeo({ x: -350, y: 0, z: 0 }, boundary),
    secondCenter = toGeo({ x: 350, y: 0, z: 0 }, boundary),
    shape = { size: 700, width: 2, offsetX: 0, offsetZ: 0 };

  // Act
  const first = await elevation(
      firstCenter,
      new AbortController().signal,
      shape,
    ),
    second = await elevation(secondCenter, new AbortController().signal, shape),
    callsAfterFirstRun = fetcher.mock.calls.length;
  await elevation(firstCenter, new AbortController().signal, shape);

  // Assert
  expect(first.values[1]).toBe(second.values[0]);
  expect(first.values[3]).toBe(second.values[2]);
  expect(new Set(fetcher.mock.calls.map(([url]) => url)).size).toBe(
    fetcher.mock.calls.length,
  );
  expect(fetcher).toHaveBeenCalledTimes(callsAfterFirstRun);
  expect(
    fetcher.mock.calls.every(([url]) => {
      const address =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      return address.includes('/terrarium/12/');
    }),
  ).toBe(true);
});

it('без отдельного флага не скачивает отсутствующий DEM', async () => {
  // Arrange
  const root = await temporaryDirectory(),
    fetcher = vi.fn(),
    elevation = createDemElevationSource({
      cache: join(root, 'dem-cache'),
      downloadMissing: false,
      fetcher,
    });

  // Act / Assert
  await expect(
    elevation({ lat: 55.75, lon: 37.61 }, new AbortController().signal, {
      size: 700,
      width: 2,
      offsetX: 0,
      offsetZ: 0,
    }),
  ).rejects.toThrow('Повторите с --download-dem');
  expect(fetcher).not.toHaveBeenCalled();
});
