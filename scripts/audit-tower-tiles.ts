import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import {
  latLonToSourceTile,
  parseSourceTileKey,
  type SourceTileBounds,
} from '../game/source-tiles.ts';
import {
  decodeTileArtifact,
  encodeTileArtifact,
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  type TileArtifactV1,
} from '../game/tile-artifact.ts';
import { isTowerStructure } from '../game/map-object-filters.ts';
import type { OSMElement } from '../game/types';

const key = (e: OSMElement) => `${e.type}/${e.id}`;
function references(e: OSMElement) {
  return e.type === 'way'
    ? (e.nodes || []).map((id) => `node/${id}`)
    : e.type === 'relation'
      ? (e.members || []).map((m) => `${m.type}/${m.ref}`)
      : [];
}
function dependencies(root: OSMElement, source: Map<string, OSMElement>) {
  const found = new Map<string, OSMElement>();
  function visit(e: OSMElement) {
    if (found.has(key(e))) return;
    found.set(key(e), e);
    for (const ref of references(e)) {
      const child = source.get(ref);
      if (!child)
        throw new Error(`Неполный источник ${key(root)}: отсутствует ${ref}.`);
      visit(child);
    }
  }
  visit(root);
  return [...found.values()];
}
function inBounds(e: OSMElement, bounds: SourceTileBounds) {
  return (
    e.type === 'node' &&
    e.lat! >= bounds.south &&
    e.lat! <= bounds.north &&
    e.lon! >= bounds.west &&
    e.lon! <= bounds.east
  );
}

export function recoverTowerElements(
  existing: OSMElement[],
  raw: OSMElement[],
  bounds: SourceTileBounds,
) {
  const source = new Map(raw.map((e) => [key(e), e])),
    result = new Map(existing.map((e) => [key(e), e])),
    recovered: string[] = [];
  for (const root of raw.filter((e) => isTowerStructure(e.tags || {}))) {
    const closure = dependencies(root, source);
    if (!closure.some((e) => inBounds(e, bounds))) continue;
    const present = result.get(key(root));
    const missingTags = Object.entries(root.tags || {}).filter(
      ([name]) => present?.tags?.[name] === undefined,
    );
    const missingGeometry = closure.some((e) => !result.has(key(e)));
    if (present && !missingTags.length && !missingGeometry) continue;
    for (const e of closure) if (!result.has(key(e))) result.set(key(e), e);
    if (present && missingTags.length)
      result.set(key(root), {
        ...present,
        tags: { ...root.tags, ...present.tags },
      });
    recovered.push(key(root));
  }
  return {
    elements: recovered.length ? [...result.values()] : existing,
    recovered,
  };
}

type Dataset = {
  datasetId: string;
  path: string;
  tiles: Record<string, { path?: string; bytes: number; checksum: string }>;
};
type Catalog = { activeDatasets: string[]; datasets: Dataset[] };
type Source = { file: string; timestamp: string };
type AuditConfig = {
  baseUrl: string;
  sources: Source[];
  localRoots: Record<string, string>;
};

export async function auditTowerTiles(config: AuditConfig, output: string) {
  const staging = resolve(output);
  await mkdir(staging, { recursive: true });
  const response = await fetch(`${config.baseUrl}/maps/catalog-v1.json`);
  if (!response.ok) throw new Error(`Каталог: HTTP ${response.status}.`);
  const catalog = (await response.json()) as Catalog;
  await writeFile(
    join(staging, 'catalog-before.json'),
    JSON.stringify(catalog, null, 2),
  );
  const effective = new Map<string, Dataset>();
  for (const id of catalog.activeDatasets) {
    const dataset = catalog.datasets.find((d) => d.datasetId === id);
    if (!dataset) throw new Error(`В каталоге отсутствует набор ${id}.`);
    for (const tile of Object.keys(dataset.tiles))
      if (!effective.has(tile)) effective.set(tile, dataset);
  }
  const sources = await Promise.all(
    config.sources.map(async (s) => ({
      ...s,
      elements: (
        JSON.parse(await readFile(s.file, 'utf8')) as { elements: OSMElement[] }
      ).elements,
    })),
  );
  const candidates = new Map<string, Map<Source, Map<string, OSMElement>>>();
  let sourceTowers = 0;
  for (const source of sources) {
    if (!Number.isFinite(Date.parse(source.timestamp)))
      throw new Error(`Некорректная дата источника ${source.file}.`);
    const raw = new Map(source.elements.map((e) => [key(e), e]));
    for (const tower of source.elements.filter((e) =>
      isTowerStructure(e.tags || {}),
    )) {
      sourceTowers++;
      const closure = dependencies(tower, raw);
      for (const node of closure.filter((e) => e.type === 'node')) {
        const tile = latLonToSourceTile(node.lat!, node.lon!);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const candidate = `${tile.z}/${tile.x + dx}/${tile.y + dy}`;
            if (!effective.has(candidate)) continue;
            const input = candidates.get(candidate) || new Map();
            const elements = input.get(source) || new Map();
            for (const element of closure) elements.set(key(element), element);
            input.set(source, elements);
            candidates.set(candidate, input);
          }
      }
    }
  }
  const entries = [...candidates.entries()],
    changed: {
      tile: string;
      dataset: string;
      recovered: string[];
      oldChecksum: string;
      checksum: string;
    }[] = [];
  const manifest: Record<
    string,
    { path: string; bytes: number; checksum: string }
  > = {};
  let cursor = 0,
    checked = 0;
  const generatedAt = new Date().toISOString();
  const worker = async () => {
    while (cursor < entries.length) {
      const [tileKey, input] = entries[cursor++],
        dataset = effective.get(tileKey)!,
        expected = dataset.tiles[tileKey];
      const tileId = parseSourceTileKey(tileKey),
        relativePath = `${tileKey}.tile.json.br`;
      let artifact: TileArtifactV1 | undefined;
      const localRoot = config.localRoots[dataset.datasetId];
      if (localRoot) {
        try {
          const local = await readFile(join(localRoot, relativePath));
          const decoded = decodeTileArtifact(
            new TextDecoder().decode(brotliDecompressSync(local)),
            tileId,
          );
          if (decoded.checksum === expected.checksum) artifact = decoded;
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              error.code === 'ENOENT'
            )
          )
            throw error;
        }
      }
      if (!artifact) {
        const response = await fetch(
          `${config.baseUrl}/${expected.path || `${dataset.path}/${relativePath}`}`,
        );
        if (!response.ok)
          throw new Error(`Тайл ${tileKey}: HTTP ${response.status}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const decoded = bytes[0] === 123 ? bytes : brotliDecompressSync(bytes);
        artifact = decodeTileArtifact(
          new TextDecoder().decode(decoded),
          tileId,
        );
        if (artifact.checksum !== expected.checksum)
          throw new Error(`Checksum каталога не совпал: ${tileKey}.`);
      }
      const original = artifact;
      const recovered: string[] = [];
      for (const [source, elements] of input) {
        const result = recoverTowerElements(
          artifact.elements,
          [...elements.values()],
          artifact.bufferedBounds,
        );
        if (!result.recovered.length) continue;
        if (!Number.isFinite(Date.parse(artifact.osmTimestamp)))
          throw new Error(`Неизвестная дата OSM тайла ${tileKey}.`);
        if (Date.parse(source.timestamp) < Date.parse(artifact.osmTimestamp))
          throw new Error(
            `Источник старее тайла ${tileKey}; требуется актуальный PBF.`,
          );
        artifact = { ...artifact, elements: result.elements };
        recovered.push(...result.recovered);
      }
      if (recovered.length) {
        const encoded = encodeTileArtifact({ ...artifact, generatedAt });
        const checksum = JSON.parse(encoded).checksum as string;
        const bytes = brotliCompressSync(Buffer.from(encoded), {
          params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
        });
        const outputPath = join(staging, relativePath);
        await mkdir(resolve(outputPath, '..'), { recursive: true });
        await writeFile(outputPath, bytes);
        manifest[tileKey] = {
          path: relativePath,
          bytes: bytes.length,
          checksum,
        };
        changed.push({
          tile: tileKey,
          dataset: dataset.datasetId,
          recovered,
          oldChecksum: original.checksum,
          checksum,
        });
      }
      checked++;
      if (checked % 100 === 0)
        console.log(
          `Проверено ${checked}/${entries.length}; изменено ${changed.length}.`,
        );
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  changed.sort((a, b) => a.tile.localeCompare(b.tile));
  const report = {
    sourceTowers,
    checkedTiles: checked,
    changedTiles: changed.length,
    changed,
    unchangedCandidateTiles: checked - changed.length,
    effectiveCatalogTiles: effective.size,
    generatedAt,
  };
  await writeFile(
    join(staging, 'tower-audit.json'),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    join(staging, 'staging-manifest-v1.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        tileSchemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
        tileBuildVersion: TILE_BUILD_VERSION,
        generatedAt,
        complete: true,
        planned: changed.length,
        tiles: manifest,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      sourceTowers,
      checkedTiles: checked,
      changedTiles: changed.length,
    }),
  );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [configFile, output] = process.argv.slice(2);
  if (!configFile || !output)
    throw new Error('Укажите JSON конфигурации источников и каталог staging.');
  await auditTowerTiles(
    JSON.parse(await readFile(configFile, 'utf8')) as AuditConfig,
    output,
  );
}
