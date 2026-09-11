import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompress } from 'node:zlib';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  decodeTileArtifact,
  encodeTileArtifact,
} from '../game/tile-artifact';
import { sourceTileBounds } from '../game/source-tiles';
import {
  emitPublishCommands,
  createS3ObjectStore,
  publishMapTiles,
  type ObjectStore,
  type StoredObject,
} from './publish-map-tiles';

const compress = promisify(brotliCompress),
  execute = promisify(execFile),
  temporaryDirectories: string[] = [],
  tile = { z: 15, x: 19808, y: 10243 };

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'street-racer-publish-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function stagingFixture() {
  const staging = await temporaryDirectory(),
    path = '15/19808/10243.tile.json.br',
    artifact = encodeTileArtifact({
      ...tile,
      schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
      tileBuildVersion: TILE_BUILD_VERSION,
      coreBounds: sourceTileBounds(tile),
      bufferedBounds: sourceTileBounds(tile),
      generatedAt: '2026-09-11T10:00:00.000Z',
      osmTimestamp: '2026-09-01T00:00:00.000Z',
      drivingSide: 'right',
      elements: [],
      elevation: {
        width: 2,
        size: 700,
        values: new Float32Array([1, 2, 3, 4]),
      },
    }),
    body = await compress(Buffer.from(artifact));
  await mkdir(join(staging, '15', '19808'), { recursive: true });
  await writeFile(join(staging, path), body);
  await writeFile(
    join(staging, 'staging-manifest-v1.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      tileSchemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
      tileBuildVersion: TILE_BUILD_VERSION,
      generatedAt: '2026-09-11T10:00:00.000Z',
      complete: true,
      planned: 1,
      tiles: {
        '15/19808/10243': {
          path,
          bytes: body.byteLength,
          checksum: decodeTileArtifact(artifact, tile).checksum,
        },
      },
    })}\n`,
    'utf8',
  );
  return { staging, body };
}

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, StoredObject>();
  readonly operations: string[] = [];
  failPut?: string;

  async head(key: string) {
    this.operations.push(`HEAD ${key}`);
    return this.objects.get(key);
  }

  async get(key: string) {
    this.operations.push(`GET ${key}`);
    return this.objects.get(key);
  }

  async put(
    key: string,
    object: StoredObject,
    conditions?: { ifMatch?: string; ifNoneMatch?: '*' },
  ) {
    this.operations.push(`PUT ${key}`);
    if (key === this.failPut) throw new Error('Тестовый сбой upload.');
    const current = this.objects.get(key);
    if (conditions?.ifNoneMatch && current)
      throw new Error('Тестовая условная запись столкнулась с объектом.');
    if (conditions?.ifMatch && current?.etag !== conditions.ifMatch)
      throw new Error('Тестовый ETag изменился.');
    this.objects.set(key, {
      ...object,
      body: new Uint8Array(object.body),
      etag: `"${createHash('md5').update(object.body).digest('hex')}"`,
    });
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('проверяет staging, публикует каталог последним и безопасно повторяет upload', async () => {
  // Arrange
  const { staging } = await stagingFixture(),
    store = new MemoryStore(),
    options = {
      staging,
      datasetId: 'moscow-2026-09-11',
      prefix: 'public',
      store,
      generatedAt: '2026-09-11T12:00:00.000Z',
      sampleSize: 1,
    };

  // Act
  const first = await publishMapTiles(options),
    firstOperations = [...store.operations];
  store.operations.length = 0;
  const second = await publishMapTiles(options);

  // Assert
  const tileKey = `public/maps/v1/${TILE_BUILD_VERSION}/moscow-2026-09-11/15/19808/10243.tile.json.br`,
    catalogKey = 'public/maps/catalog-v1.json';
  expect(first).toMatchObject({ uploaded: 1, skipped: 0, verified: 1 });
  expect(second).toMatchObject({ uploaded: 0, skipped: 1, verified: 1 });
  expect(firstOperations.at(-1)).toBe(`PUT ${catalogKey}`);
  expect(store.objects.get(tileKey)).toMatchObject({
    contentType: 'application/json',
    contentEncoding: 'br',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  const catalog = JSON.parse(
    new TextDecoder().decode(store.objects.get(catalogKey)?.body),
  );
  expect(catalog).toMatchObject({
    schemaVersion: 1,
    activeDatasets: ['moscow-2026-09-11'],
    datasets: [
      {
        datasetId: 'moscow-2026-09-11',
        path: `maps/v1/${TILE_BUILD_VERSION}/moscow-2026-09-11`,
      },
    ],
  });
  expect(firstOperations.indexOf(`PUT ${catalogKey}`)).toBeGreaterThan(
    firstOperations.indexOf(`GET ${tileKey}`),
  );
});

it('не активирует dataset при частично неуспешной загрузке', async () => {
  // Arrange
  const { staging } = await stagingFixture(),
    store = new MemoryStore();
  store.failPut = `maps/v1/${TILE_BUILD_VERSION}/broken/15/19808/10243.tile.json.br`;

  // Act / Assert
  await expect(
    publishMapTiles({ staging, datasetId: 'broken', prefix: '', store }),
  ).rejects.toThrow('Тестовый сбой upload.');
  expect(store.operations).not.toContain('PUT maps/catalog-v1.json');
});

it('dry-run не обращается к бакету и отклоняет неполный manifest', async () => {
  // Arrange
  const { staging } = await stagingFixture(),
    store = new MemoryStore(),
    manifestPath = join(staging, 'staging-manifest-v1.json'),
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  // Act
  const report = await publishMapTiles({
    staging,
    datasetId: 'dry-run',
    prefix: 'maps-prod',
    store,
    dryRun: true,
  });

  // Assert
  expect(report).toMatchObject({ planned: 1, uploaded: 0, skipped: 0 });
  expect(store.operations).toEqual([]);
  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, complete: false }),
    'utf8',
  );
  await expect(
    publishMapTiles({ staging, datasetId: 'invalid', prefix: '', store }),
  ).rejects.toThrow('Staging manifest не завершён');
});

it('реальный CLI выполняет dry-run и не выводит переданные credentials', async () => {
  // Arrange
  const { staging } = await stagingFixture(),
    script = join(process.cwd(), 'scripts', 'publish-map-tiles.ts');

  // Act
  const { stdout, stderr } = await execute(process.execPath, [
    '--experimental-transform-types',
    script,
    '--staging',
    staging,
    '--dataset-id',
    'cli-dry-run',
    '--endpoint',
    'https://storage.yandexcloud.net',
    '--bucket',
    'example-bucket',
    '--access-key',
    'public-id',
    '--secret-key',
    'secret-value',
    '--dry-run',
  ]);

  // Assert
  expect(stdout).toContain('"kind": "publish-report"');
  expect(stdout).toContain('"planned": 1');
  expect(`${stdout}${stderr}`).not.toContain('public-id');
  expect(`${stdout}${stderr}`).not.toContain('secret-value');
});

it('режим команд не раскрывает credentials и не выполняет запросы', async () => {
  // Arrange
  const { staging } = await stagingFixture();

  // Act
  const commands = await emitPublishCommands({
    staging,
    datasetId: 'pilot',
    prefix: '$web',
    endpoint: 'https://storage.yandexcloud.net',
    bucket: 'example-bucket',
  });

  // Assert
  expect(commands).toContain('AWS_ACCESS_KEY_ID');
  expect(commands).toContain('AWS_SECRET_ACCESS_KEY');
  expect(commands).toContain('--endpoint-url');
  expect(commands).toContain('head-object');
  expect(commands).toContain('get-object');
  expect(commands).toContain('--content-md5');
  expect(commands).toContain("'$web/maps/v1/");
  expect(commands).toContain("--if-none-match '*'");
  expect(commands).not.toContain('<путь-');
  expect(commands).not.toContain('<current-');
  expect(commands).not.toContain('secret-value');
});

it('режим команд связывает локальный current catalog с его ETag', async () => {
  // Arrange
  const { staging } = await stagingFixture(),
    currentCatalog = join(staging, 'current-catalog.json'),
    body = `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-09-11T09:00:00.000Z',
      activeDatasets: [],
      datasets: [],
    })}\n`;
  await writeFile(currentCatalog, body, 'utf8');

  // Act / Assert
  await expect(
    emitPublishCommands({
      staging,
      datasetId: 'pilot',
      prefix: '',
      endpoint: 'https://storage.yandexcloud.net',
      bucket: 'example-bucket',
      currentCatalog,
      currentCatalogEtag: '"00000000000000000000000000000000"',
    }),
  ).rejects.toThrow('ETag не соответствует');
  const etag = `"${createHash('md5').update(body).digest('hex')}"`,
    commands = await emitPublishCommands({
      staging,
      datasetId: 'pilot',
      prefix: '',
      endpoint: 'https://storage.yandexcloud.net',
      bucket: 'example-bucket',
      currentCatalog,
      currentCatalogEtag: etag,
    });
  expect(commands).toContain(`--if-match '${etag}'`);
});

it('S3-клиент подписывает запрос SigV4 и не помещает секрет в адрес', async () => {
  // Arrange
  const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=public-id\//,
      );
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': '4',
          'content-type': 'application/json',
          'cache-control': 'public, max-age=31536000, immutable',
          'content-encoding': 'br',
          'x-amz-meta-tile-checksum': 'crc32:12345678',
        },
      });
    }),
    store = createS3ObjectStore({
      endpoint: 'https://storage.yandexcloud.net',
      bucket: 'example-bucket',
      region: 'ru-central1',
      accessKey: 'public-id',
      secretKey: 'secret-value',
      fetcher: fetcher as typeof fetch,
      now: () => new Date('2026-09-11T12:00:00.000Z'),
    });

  // Act
  const result = await store.head("maps/weird!'()*.json");
  await store.put(
    'maps/new-object',
    {
      body: new Uint8Array([1, 2, 3]),
      contentLength: 3,
      contentType: 'application/json',
      cacheControl: 'no-cache',
    },
    { ifNoneMatch: '*' },
  );

  // Assert
  expect(result).toMatchObject({ contentLength: 4 });
  const called = fetcher.mock.calls[0]?.[0];
  expect(called).toBeInstanceOf(URL);
  const calledUrl = (called as URL).href;
  expect(calledUrl).toBe(
    'https://storage.yandexcloud.net/example-bucket/maps/weird%21%27%28%29%2A.json',
  );
  expect(calledUrl).not.toContain('public-id');
  expect(calledUrl).not.toContain('secret-value');
  const putHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
  expect(putHeaders.get('if-none-match')).toBe('*');
  expect(putHeaders.get('content-md5')).toBe('Uonfc331cyb83SJZevsfrA==');
});

it('не отправляет credentials по HTTP вне явно разрешённого loopback', async () => {
  // Arrange / Act / Assert
  expect(() =>
    createS3ObjectStore({
      endpoint: 'http://storage.example',
      bucket: 'example-bucket',
      region: 'ru-central1',
      accessKey: 'public-id',
      secretKey: 'secret-value',
    }),
  ).toThrow('Незашифрованный S3 endpoint');
  expect(() =>
    createS3ObjectStore({
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'local-bucket',
      region: 'ru-central1',
      accessKey: 'local-id',
      secretKey: 'local-secret',
      allowInsecureLocal: true,
    }),
  ).not.toThrow();
  expect(() =>
    createS3ObjectStore({
      endpoint: 'https://storage.yandexcloud.net?unsafe=query',
      bucket: 'example-bucket',
      region: 'ru-central1',
      accessKey: 'public-id',
      secretKey: 'secret-value',
    }),
  ).toThrow('query');
  await expect(
    emitPublishCommands({
      staging: 'not-read-because-endpoint-is-checked-first',
      datasetId: 'test',
      prefix: '',
      endpoint: 'http://storage.example',
      bucket: 'example-bucket',
    }),
  ).rejects.toThrow('Незашифрованный S3 endpoint');
});
