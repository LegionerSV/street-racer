#!/usr/bin/env node

import { createHash, createHmac } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  decodeTileArtifact,
} from '../game/tile-artifact.ts';
import { parseSourceTileKey } from '../game/source-tiles.ts';

const decompress = promisify(brotliDecompress),
  TILE_CACHE_CONTROL = 'public, max-age=31536000, immutable',
  CATALOG_CACHE_CONTROL = 'no-cache, max-age=0',
  MANIFEST_FILE = 'staging-manifest-v1.json';

type ObjectHeaders = {
  contentLength: number;
  contentType: string;
  contentEncoding?: string;
  cacheControl: string;
  metadata?: Record<string, string>;
  etag?: string;
};

export type StoredObject = ObjectHeaders & { body: Uint8Array };

type PutConditions = { ifMatch?: string; ifNoneMatch?: '*' };

export interface ObjectStore {
  head(key: string): Promise<ObjectHeaders | undefined>;
  get(key: string): Promise<StoredObject | undefined>;
  put(
    key: string,
    object: StoredObject,
    conditions?: PutConditions,
  ): Promise<void>;
}

type ManifestTile = { path: string; bytes: number; checksum: string };

type StagingManifest = {
  schemaVersion: 1;
  tileSchemaVersion: 1;
  tileBuildVersion: string;
  generatedAt: string;
  complete: boolean;
  planned: number;
  tiles: Record<string, ManifestTile>;
};

type CatalogDataset = {
  datasetId: string;
  schemaVersion: number;
  tileBuildVersion: string;
  path: string;
  tiles: Record<string, { bytes: number; checksum: string }>;
};

type TileCatalog = {
  schemaVersion: 1;
  generatedAt: string;
  activeDatasets: string[];
  datasets: CatalogDataset[];
};

export type PublisherOptions = {
  staging: string;
  datasetId: string;
  prefix: string;
  store: ObjectStore;
  dryRun?: boolean;
  sampleSize?: number;
  generatedAt?: string;
};

export type PublisherReport = {
  planned: number;
  uploaded: number;
  skipped: number;
  verified: number;
  datasetPath: string;
  catalogKey: string;
};

type CommandOptions = Omit<PublisherOptions, 'store'> & {
  endpoint: string;
  bucket: string;
  currentCatalog?: string;
  currentCatalogEtag?: string;
  allowInsecureLocal?: boolean;
};

type S3Options = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  allowInsecureLocal?: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePrefix(prefix: string) {
  const normalized = prefix.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (normalized.split('/').some((part) => part === '.' || part === '..'))
    throw new Error('Prefix содержит небезопасный сегмент пути.');
  return normalized;
}

function validateEndpoint(value: string, allowInsecureLocal = false) {
  const endpoint = new URL(value);
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new Error('S3 endpoint должен использовать http или https.');
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '' && endpoint.pathname !== '/')
  )
    throw new Error(
      'S3 endpoint не должен содержать credentials, path, query или fragment.',
    );
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    endpoint.hostname,
  );
  if (endpoint.protocol !== 'https:' && !(allowInsecureLocal && loopback))
    throw new Error(
      'Незашифрованный S3 endpoint разрешён только для loopback с --allow-insecure-local-endpoint.',
    );
  return endpoint;
}

function sigV4Encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function objectKey(prefix: string, path: string) {
  return [normalizePrefix(prefix), path].filter(Boolean).join('/');
}

function validateDatasetId(datasetId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(datasetId))
    throw new Error(
      'Dataset id должен состоять из латинских букв, цифр, точки, дефиса или подчёркивания.',
    );
}

async function artifactFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        `Staging не должен содержать symlink или junction: ${path}.`,
      );
    if (entry.isDirectory()) result.push(...(await artifactFiles(root, path)));
    else if (entry.isFile() && entry.name.endsWith('.tile.json.br'))
      result.push(relative(root, path).split(sep).join('/'));
  }
  return result.sort();
}

async function assertNoLinks(root: string, target: string) {
  const inside = relative(root, target);
  let current = root;
  for (const part of ['', ...inside.split(sep)]) {
    if (part) current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(
          `Staging не должен содержать symlink или junction: ${current}.`,
        );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return;
      throw error;
    }
  }
}

async function readManifest(stagingValue: string) {
  const staging = resolve(stagingValue);
  if ((await lstat(staging)).isSymbolicLink())
    throw new Error('Staging-каталог не должен быть symlink или junction.');
  let parsed: unknown;
  try {
    const manifestPath = resolve(staging, MANIFEST_FILE);
    await assertNoLinks(staging, manifestPath);
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Не удалось прочитать ${MANIFEST_FILE}.`, { cause: error });
  }
  if (
    !isObject(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.tileSchemaVersion !== TILE_ARTIFACT_SCHEMA_VERSION ||
    parsed.tileBuildVersion !== TILE_BUILD_VERSION ||
    typeof parsed.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.generatedAt)) ||
    typeof parsed.complete !== 'boolean' ||
    !Number.isInteger(parsed.planned) ||
    (parsed.planned as number) < 1 ||
    !isObject(parsed.tiles)
  )
    throw new Error(
      'Staging manifest имеет несовместимый или неверный формат.',
    );
  const manifest = parsed as StagingManifest;
  if (!manifest.complete)
    throw new Error('Staging manifest не завершён; публикация запрещена.');
  const entries = Object.entries(manifest.tiles);
  if (entries.length !== manifest.planned)
    throw new Error('Staging manifest содержит пропуски относительно плана.');

  const validated: Array<{
    tileKey: string;
    descriptor: ManifestTile;
    body: Uint8Array;
  }> = [];
  for (const [tileKey, value] of entries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      !isObject(value) ||
      typeof value.path !== 'string' ||
      !Number.isInteger(value.bytes) ||
      (value.bytes as number) < 1 ||
      typeof value.checksum !== 'string'
    )
      throw new Error(
        `Manifest содержит неверную запись source-тайла ${tileKey}.`,
      );
    const tile = parseSourceTileKey(tileKey),
      expectedPath = `${tile.z}/${tile.x}/${tile.y}.tile.json.br`;
    if (value.path !== expectedPath)
      throw new Error(`Путь source-тайла ${tileKey} не соответствует его XYZ.`);
    const target = resolve(staging, ...expectedPath.split('/')),
      inside = relative(staging, target);
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
      throw new Error(
        `Путь source-тайла ${tileKey} выходит за пределы staging.`,
      );
    await assertNoLinks(staging, target);
    const body = await readFile(target);
    if (body.byteLength !== value.bytes)
      throw new Error(
        `Размер source-тайла ${tileKey} не совпадает с manifest.`,
      );
    let artifact;
    try {
      artifact = decodeTileArtifact(
        new TextDecoder().decode(await decompress(body)),
        tile,
      );
    } catch (error) {
      throw new Error(`Source-тайл ${tileKey} не прошёл проверку.`, {
        cause: error,
      });
    }
    if (artifact.checksum !== value.checksum)
      throw new Error(
        `Checksum source-тайла ${tileKey} не совпадает с manifest.`,
      );
    validated.push({
      tileKey,
      descriptor: value as ManifestTile,
      body,
    });
  }
  const actualFiles = await artifactFiles(staging),
    listedFiles = validated.map(({ descriptor }) => descriptor.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(listedFiles))
    throw new Error(
      'Staging содержит TileArtifactV1, отсутствующий в manifest.',
    );
  return { manifest, tiles: validated };
}

function bodyEtag(body: Uint8Array) {
  return `"${createHash('md5').update(body).digest('hex')}"`;
}

function samePublishedObject(
  object: ObjectHeaders,
  tile: ManifestTile,
  body: Uint8Array,
) {
  return (
    object.contentLength === tile.bytes &&
    object.contentType === 'application/json' &&
    object.contentEncoding === 'br' &&
    object.cacheControl === TILE_CACHE_CONTROL &&
    object.metadata?.['tile-checksum'] === tile.checksum &&
    object.etag === bodyEtag(body)
  );
}

function verificationIndexes(length: number, requested: number) {
  if (!Number.isInteger(requested) || requested < 1)
    throw new Error(
      'Размер контрольной выборки должен быть положительным целым числом.',
    );
  const count = Math.max(1, Math.min(length, Math.floor(requested)));
  return [
    ...new Set(
      Array.from({ length: count }, (_, index) =>
        Math.round((index * (length - 1)) / Math.max(1, count - 1)),
      ),
    ),
  ];
}

async function decodePublishedArtifact(
  body: Uint8Array,
  tile: ReturnType<typeof parseSourceTileKey>,
) {
  try {
    return decodeTileArtifact(
      new TextDecoder().decode(await decompress(body)),
      tile,
    );
  } catch (compressedError) {
    try {
      // Node fetch может прозрачно распаковать Content-Encoding: br.
      return decodeTileArtifact(new TextDecoder().decode(body), tile);
    } catch {
      throw compressedError;
    }
  }
}

function parseCatalog(
  object: StoredObject | undefined,
): TileCatalog | undefined {
  if (!object) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(object.body));
  } catch (error) {
    throw new Error('Опубликованный catalog-v1.json содержит неверный JSON.', {
      cause: error,
    });
  }
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.activeDatasets) ||
    !Array.isArray(value.datasets)
  )
    throw new Error('Опубликованный catalog-v1.json имеет неверный формат.');
  return value as TileCatalog;
}

export async function publishMapTiles(
  options: PublisherOptions,
): Promise<PublisherReport> {
  if (!options.staging.trim())
    throw new Error('Staging-каталог должен быть указан явно.');
  validateDatasetId(options.datasetId);
  const prefix = normalizePrefix(options.prefix),
    { manifest, tiles } = await readManifest(options.staging),
    datasetPath = `maps/v1/${manifest.tileBuildVersion}/${options.datasetId}`,
    catalogKey = objectKey(prefix, 'maps/catalog-v1.json'),
    verification = verificationIndexes(tiles.length, options.sampleSize ?? 3),
    report: PublisherReport = {
      planned: tiles.length,
      uploaded: 0,
      skipped: 0,
      verified: 0,
      datasetPath,
      catalogKey,
    };
  if (options.dryRun) return report;

  const currentCatalogObject = await options.store.get(catalogKey),
    currentCatalog = parseCatalog(currentCatalogObject),
    dataset: CatalogDataset = {
      datasetId: options.datasetId,
      schemaVersion: manifest.tileSchemaVersion,
      tileBuildVersion: manifest.tileBuildVersion,
      path: datasetPath,
      tiles: Object.fromEntries(
        tiles.map(({ tileKey, descriptor }) => [
          tileKey,
          { bytes: descriptor.bytes, checksum: descriptor.checksum },
        ]),
      ),
    },
    previousSameId = currentCatalog?.datasets.find(
      (item) => item.datasetId === options.datasetId,
    );
  if (
    previousSameId &&
    JSON.stringify(previousSameId) !== JSON.stringify(dataset)
  )
    throw new Error(
      `Dataset ${options.datasetId} уже зарегистрирован с другим содержимым.`,
    );

  for (const { descriptor, body } of tiles) {
    const key = objectKey(prefix, `${datasetPath}/${descriptor.path}`),
      existing = await options.store.head(key);
    if (existing) {
      if (!samePublishedObject(existing, descriptor, body))
        throw new Error(
          `Immutable объект ${key} уже существует с другим содержимым или заголовками.`,
        );
      report.skipped++;
      continue;
    }
    await options.store.put(
      key,
      {
        body,
        contentLength: body.byteLength,
        contentType: 'application/json',
        contentEncoding: 'br',
        cacheControl: TILE_CACHE_CONTROL,
        metadata: { 'tile-checksum': descriptor.checksum },
      },
      { ifNoneMatch: '*' },
    );
    report.uploaded++;
  }

  for (const index of verification) {
    const tile = tiles[index],
      key = objectKey(prefix, `${datasetPath}/${tile.descriptor.path}`),
      remote = await options.store.get(key);
    if (!remote || !samePublishedObject(remote, tile.descriptor, tile.body))
      throw new Error(`Контрольное чтение ${key} вернуло неверные метаданные.`);
    const id = parseSourceTileKey(tile.tileKey),
      artifact = await decodePublishedArtifact(remote.body, id);
    if (artifact.checksum !== tile.descriptor.checksum)
      throw new Error(`Контрольное чтение ${key} вернуло неверный checksum.`);
    report.verified++;
  }

  const catalog: TileCatalog = {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    activeDatasets: [
      options.datasetId,
      ...(currentCatalog?.activeDatasets.filter(
        (id) => id !== options.datasetId,
      ) ?? []),
    ],
    datasets: [
      dataset,
      ...(currentCatalog?.datasets.filter(
        (item) => item.datasetId !== options.datasetId,
      ) ?? []),
    ],
  };
  const catalogBody = new TextEncoder().encode(
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  if (currentCatalog && !currentCatalogObject?.etag)
    throw new Error(
      'S3 не вернул ETag текущего каталога; атомарное обновление невозможно.',
    );
  await options.store.put(
    catalogKey,
    {
      body: catalogBody,
      contentLength: catalogBody.byteLength,
      contentType: 'application/json; charset=utf-8',
      cacheControl: CATALOG_CACHE_CONTROL,
    },
    currentCatalogObject
      ? { ifMatch: currentCatalogObject.etag! }
      : { ifNoneMatch: '*' },
  );
  return report;
}

function powershellLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function emitPublishCommands(options: CommandOptions) {
  validateDatasetId(options.datasetId);
  validateEndpoint(options.endpoint, options.allowInsecureLocal);
  const prefix = normalizePrefix(options.prefix),
    { manifest, tiles } = await readManifest(options.staging),
    datasetPath = `maps/v1/${manifest.tileBuildVersion}/${options.datasetId}`,
    catalogKey = objectKey(prefix, 'maps/catalog-v1.json'),
    currentCatalogBody = options.currentCatalog
      ? await readFile(resolve(options.currentCatalog))
      : undefined;
  if (!!currentCatalogBody !== !!options.currentCatalogEtag)
    throw new Error(
      'Для существующего каталога одновременно укажите --current-catalog и --current-catalog-etag.',
    );
  const currentCatalogEtag = options.currentCatalogEtag
    ? `"${options.currentCatalogEtag.replace(/^"|"$/g, '').toLowerCase()}"`
    : undefined;
  if (
    currentCatalogBody &&
    (!/^"[0-9a-f]{32}"$/.test(currentCatalogEtag!) ||
      bodyEtag(currentCatalogBody) !== currentCatalogEtag)
  )
    throw new Error(
      'ETag не соответствует локальному current catalog; генерация команд запрещена.',
    );
  const currentCatalog = currentCatalogBody
      ? parseCatalog({
          body: currentCatalogBody,
          contentLength: currentCatalogBody.byteLength,
          contentType: 'application/json',
          cacheControl: '',
        })
      : undefined,
    dataset: CatalogDataset = {
      datasetId: options.datasetId,
      schemaVersion: manifest.tileSchemaVersion,
      tileBuildVersion: manifest.tileBuildVersion,
      path: datasetPath,
      tiles: Object.fromEntries(
        tiles.map(({ tileKey, descriptor }) => [
          tileKey,
          { bytes: descriptor.bytes, checksum: descriptor.checksum },
        ]),
      ),
    },
    previousSameId = currentCatalog?.datasets.find(
      (item) => item.datasetId === options.datasetId,
    );
  if (
    previousSameId &&
    JSON.stringify(previousSameId) !== JSON.stringify(dataset)
  )
    throw new Error(
      `Dataset ${options.datasetId} уже зарегистрирован с другим содержимым.`,
    );
  const catalog: TileCatalog = {
      schemaVersion: 1,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      activeDatasets: [
        options.datasetId,
        ...(currentCatalog?.activeDatasets.filter(
          (id) => id !== options.datasetId,
        ) ?? []),
      ],
      datasets: [
        dataset,
        ...(currentCatalog?.datasets.filter(
          (item) => item.datasetId !== options.datasetId,
        ) ?? []),
      ],
    },
    catalogBody = new TextEncoder().encode(
      `${JSON.stringify(catalog, null, 2)}\n`,
    ),
    s3Command = (operation: string) =>
      `aws s3api ${operation} --endpoint-url ${powershellLiteral(options.endpoint)} --bucket ${powershellLiteral(options.bucket)}`,
    lines = [
      '# Credentials читаются AWS CLI из AWS_ACCESS_KEY_ID и AWS_SECRET_ACCESS_KEY.',
      '# При временных ключах также задайте AWS_SESSION_TOKEN.',
      "$ErrorActionPreference = 'Stop'",
      'function Assert-AwsSuccess { if ($LASTEXITCODE -ne 0) { throw "AWS CLI завершился с кодом $LASTEXITCODE." } }',
      "$publishTemp = Join-Path ([IO.Path]::GetTempPath()) ('street-racer-publish-' + [guid]::NewGuid())",
      'New-Item -ItemType Directory -Path $publishTemp | Out-Null',
      'try {',
    ];
  for (const [index, { descriptor, body }] of tiles.entries()) {
    const key = objectKey(prefix, `${datasetPath}/${descriptor.path}`),
      path = resolve(options.staging, ...descriptor.path.split('/')),
      variable = `$tileHead${index}`,
      expectedEtag = bodyEtag(body),
      contentMd5 = createHash('md5').update(body).digest('base64');
    lines.push(
      `  ${variable}Json = & ${s3Command('head-object')} --key ${powershellLiteral(key)} --output json 2>$null`,
      '  if ($LASTEXITCODE -eq 0) {',
      `    ${variable} = ${variable}Json | ConvertFrom-Json`,
      `    if ([long]${variable}.ContentLength -ne ${descriptor.bytes} -or ${variable}.ContentType -ne 'application/json' -or ${variable}.ContentEncoding -ne 'br' -or ${variable}.CacheControl -ne ${powershellLiteral(TILE_CACHE_CONTROL)} -or ${variable}.Metadata.'tile-checksum' -ne ${powershellLiteral(descriptor.checksum)} -or ${variable}.ETag -ne ${powershellLiteral(expectedEtag)}) { throw ${powershellLiteral(`Immutable объект ${key} уже существует с другим содержимым или заголовками.`)} }`,
      '  } else {',
      `    ${s3Command('put-object')} --key ${powershellLiteral(key)} --body ${powershellLiteral(path)} --content-type application/json --content-encoding br --cache-control ${powershellLiteral(TILE_CACHE_CONTROL)} --metadata ${powershellLiteral(`tile-checksum=${descriptor.checksum}`)} --content-md5 ${powershellLiteral(contentMd5)} --if-none-match '*' | Out-Null`,
      '    Assert-AwsSuccess',
      '  }',
    );
  }
  for (const index of verificationIndexes(
    tiles.length,
    options.sampleSize ?? 3,
  )) {
    const { descriptor } = tiles[index],
      local = resolve(options.staging, ...descriptor.path.split('/')),
      remoteName = `verify-${index}.tile.json.br`;
    lines.push(
      `  ${s3Command('get-object')} --key ${powershellLiteral(objectKey(prefix, `${datasetPath}/${descriptor.path}`))} (Join-Path $publishTemp ${powershellLiteral(remoteName)}) | Out-Null`,
      '  Assert-AwsSuccess',
      `  if ((Get-FileHash -Algorithm MD5 ${powershellLiteral(local)}).Hash -ne (Get-FileHash -Algorithm MD5 (Join-Path $publishTemp ${powershellLiteral(remoteName)})).Hash) { throw ${powershellLiteral(`Контрольное чтение ${descriptor.path} не совпало с локальным файлом.`)} }`,
    );
  }
  lines.push(
    `  [IO.File]::WriteAllBytes((Join-Path $publishTemp 'catalog-v1.json'), [Convert]::FromBase64String(${powershellLiteral(Buffer.from(catalogBody).toString('base64'))}))`,
    `  ${s3Command('put-object')} --key ${powershellLiteral(catalogKey)} --body (Join-Path $publishTemp 'catalog-v1.json') --content-type ${powershellLiteral('application/json; charset=utf-8')} --cache-control ${powershellLiteral(CATALOG_CACHE_CONTROL)} --content-md5 ${powershellLiteral(createHash('md5').update(catalogBody).digest('base64'))} ${currentCatalogEtag ? `--if-match ${powershellLiteral(currentCatalogEtag)}` : "--if-none-match '*'"} | Out-Null`,
    '  Assert-AwsSuccess',
    '} finally {',
    '  Remove-Item -LiteralPath $publishTemp -Recurse -Force',
    '}',
  );
  return lines.join('\n');
}

function hash(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Uint8Array, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function responseHeaders(response: Response, body: Uint8Array): StoredObject {
  return {
    body,
    contentLength: Number(
      response.headers.get('content-length') ?? body.length,
    ),
    contentType: response.headers.get('content-type') ?? '',
    ...(response.headers.get('content-encoding')
      ? { contentEncoding: response.headers.get('content-encoding')! }
      : {}),
    cacheControl: response.headers.get('cache-control') ?? '',
    metadata: Object.fromEntries(
      [...response.headers.entries()]
        .filter(([name]) => name.startsWith('x-amz-meta-'))
        .map(([name, value]) => [name.slice('x-amz-meta-'.length), value]),
    ),
    ...(response.headers.get('etag')
      ? { etag: response.headers.get('etag')! }
      : {}),
  };
}

export function createS3ObjectStore(options: S3Options): ObjectStore {
  const endpoint = validateEndpoint(
      options.endpoint,
      options.allowInsecureLocal,
    ),
    fetcher = options.fetcher ?? fetch,
    now = options.now ?? (() => new Date());
  if (!options.bucket.trim()) throw new Error('S3 bucket должен быть указан.');
  if (!options.accessKey || !options.secretKey)
    throw new Error('Для публикации нужны S3 credentials.');

  const request = async (
    method: 'GET' | 'HEAD' | 'PUT',
    key: string,
    object?: StoredObject,
    conditions?: PutConditions,
  ) => {
    const url = new URL(endpoint),
      encodedPath = [options.bucket, ...key.split('/')]
        .map(sigV4Encode)
        .join('/');
    url.pathname = `/${encodedPath}`;
    const body = object?.body,
      payloadHash = hash(body ?? new Uint8Array()),
      moment = now(),
      amzDate = moment.toISOString().replace(/[:-]|\.\d{3}/g, ''),
      date = amzDate.slice(0, 8),
      headers = new Headers({
        host: url.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      });
    if (options.sessionToken)
      headers.set('x-amz-security-token', options.sessionToken);
    if (conditions?.ifMatch) headers.set('if-match', conditions.ifMatch);
    if (conditions?.ifNoneMatch)
      headers.set('if-none-match', conditions.ifNoneMatch);
    if (object) {
      headers.set('content-type', object.contentType);
      headers.set('cache-control', object.cacheControl);
      headers.set(
        'content-md5',
        createHash('md5').update(object.body).digest('base64'),
      );
      if (object.contentEncoding)
        headers.set('content-encoding', object.contentEncoding);
      for (const [name, value] of Object.entries(object.metadata ?? {}))
        headers.set(`x-amz-meta-${name}`, value);
    }
    const canonicalEntries = [...headers.entries()]
        .map(
          ([name, value]) =>
            [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const,
        )
        .sort(([left], [right]) => left.localeCompare(right)),
      signedHeaders = canonicalEntries.map(([name]) => name).join(';'),
      canonicalHeaders = `${canonicalEntries.map(([name, value]) => `${name}:${value}`).join('\n')}\n`,
      canonicalRequest = [
        method,
        url.pathname,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n'),
      scope = `${date}/${options.region}/s3/aws4_request`,
      stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonicalRequest)}`,
      signingKey = hmac(
        hmac(
          hmac(hmac(`AWS4${options.secretKey}`, date), options.region),
          's3',
        ),
        'aws4_request',
      ),
      signature = createHmac('sha256', signingKey)
        .update(stringToSign)
        .digest('hex');
    headers.set(
      'authorization',
      `AWS4-HMAC-SHA256 Credential=${options.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    );
    const response = await fetcher(url, {
      method,
      headers,
      ...(body ? { body: Buffer.from(body) } : {}),
    });
    if (response.status === 404 && method !== 'PUT') return undefined;
    if (!response.ok)
      throw new Error(
        `S3 вернул HTTP ${response.status} для ${method} ${key}.`,
      );
    const responseBody =
      method === 'GET'
        ? new Uint8Array(await response.arrayBuffer())
        : new Uint8Array();
    return responseHeaders(response, responseBody);
  };
  return {
    head: (key) => request('HEAD', key),
    get: (key) => request('GET', key),
    put: async (key, object, conditions) => {
      await request('PUT', key, object, conditions);
    },
  };
}

function argumentValue(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}

function required(value: string | undefined, description: string) {
  if (!value?.trim()) throw new Error(`Укажите ${description}.`);
  return value;
}

async function main() {
  try {
    const arguments_ = process.argv.slice(2),
      staging = required(argumentValue(arguments_, '--staging'), '--staging'),
      datasetId = required(
        argumentValue(arguments_, '--dataset-id') ?? process.env.MAP_DATASET_ID,
        '--dataset-id или MAP_DATASET_ID',
      ),
      endpoint = required(
        argumentValue(arguments_, '--endpoint') ?? process.env.S3_ENDPOINT,
        '--endpoint или S3_ENDPOINT',
      ),
      bucket = required(
        argumentValue(arguments_, '--bucket') ?? process.env.S3_BUCKET,
        '--bucket или S3_BUCKET',
      ),
      prefix =
        argumentValue(arguments_, '--prefix') ?? process.env.S3_PREFIX ?? '',
      dryRun = arguments_.includes('--dry-run');
    if (arguments_.includes('--emit-commands')) {
      console.log(
        await emitPublishCommands({
          staging,
          datasetId,
          endpoint,
          bucket,
          prefix,
          sampleSize: Number(argumentValue(arguments_, '--sample-size') ?? 3),
          currentCatalog: argumentValue(arguments_, '--current-catalog'),
          currentCatalogEtag: argumentValue(
            arguments_,
            '--current-catalog-etag',
          ),
          allowInsecureLocal: arguments_.includes(
            '--allow-insecure-local-endpoint',
          ),
        }),
      );
      return;
    }
    const store = dryRun
        ? ({
            head: async () => undefined,
            get: async () => undefined,
            put: async () => {},
          } satisfies ObjectStore)
        : createS3ObjectStore({
            endpoint,
            bucket,
            region:
              argumentValue(arguments_, '--region') ??
              process.env.AWS_REGION ??
              'ru-central1',
            accessKey: required(
              argumentValue(arguments_, '--access-key') ??
                process.env.AWS_ACCESS_KEY_ID,
              '--access-key или AWS_ACCESS_KEY_ID',
            ),
            secretKey: required(
              argumentValue(arguments_, '--secret-key') ??
                process.env.AWS_SECRET_ACCESS_KEY,
              '--secret-key или AWS_SECRET_ACCESS_KEY',
            ),
            sessionToken:
              argumentValue(arguments_, '--session-token') ??
              process.env.AWS_SESSION_TOKEN,
            allowInsecureLocal: arguments_.includes(
              '--allow-insecure-local-endpoint',
            ),
          }),
      report = await publishMapTiles({
        staging,
        datasetId,
        prefix,
        store,
        dryRun,
        sampleSize: Number(argumentValue(arguments_, '--sample-size') ?? 3),
      });
    console.log(JSON.stringify({ kind: 'publish-report', ...report }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
