import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { auditTowerTiles, recoverTowerElements } from './audit-tower-tiles';
import {
  latLonToSourceTile,
  sourceTileBounds,
  sourceTileKey,
} from '../game/source-tiles';
import {
  encodeTileArtifact,
  decodeTileArtifact,
  TILE_BUILD_VERSION,
} from '../game/tile-artifact';
import type { OSMElement } from '../game/types';

const nodes: OSMElement[] = [
  { type: 'node', id: 1, lat: 59, lon: 30 },
  { type: 'node', id: 2, lat: 59.001, lon: 30 },
  { type: 'node', id: 3, lat: 59.001, lon: 30.001 },
];
const tower: OSMElement = {
  type: 'way',
  id: 4,
  nodes: [1, 2, 3, 1],
  tags: { man_made: 'water_tower', height: '30' },
};
const bounds = { south: 58.99, north: 59.01, west: 29.99, east: 30.01 };

it('восстанавливает только потерянную башню и её отсутствующие зависимости', () => {
  // Arrange
  const existing: OSMElement[] = [
    nodes[0],
    {
      type: 'node',
      id: 99,
      lat: 59,
      lon: 30,
      tags: { name: 'Существующий объект' },
    },
  ];
  // Act
  const result = recoverTowerElements(existing, [...nodes, tower], bounds);
  // Assert
  expect(result.recovered).toEqual(['way/4']);
  expect(result.elements.slice(0, 2)).toEqual(existing);
  expect(result.elements).toHaveLength(5);
  expect(result.elements.find((e) => e.id === 4)).toEqual(tower);
});

it('не изменяет тайл, в котором информация уже есть', () => {
  // Arrange
  const existing = [...nodes, tower];
  // Act
  const result = recoverTowerElements(existing, existing, bounds);
  // Assert
  expect(result.recovered).toHaveLength(0);
  expect(result.elements).toBe(existing);
});

it('восстанавливает геометрию, когда башня и все её теги уже присутствуют', () => {
  // Arrange
  const existing = [nodes[0], tower];
  // Act
  const result = recoverTowerElements(existing, [...nodes, tower], bounds);
  // Assert
  expect(result.recovered).toEqual(['way/4']);
  expect(result.elements).toHaveLength(4);
  expect(result.elements.find((e) => e.id === 4)).toBe(tower);
});

it('восстанавливает потерянные теги существующей зависимости и сохраняет новые данные', () => {
  // Arrange
  const existing = [
    ...nodes,
    { ...tower, tags: { building: 'yes', name: 'Имя из нового набора' } },
  ];
  // Act
  const result = recoverTowerElements(existing, [...nodes, tower], bounds);
  // Assert
  expect(result.recovered).toEqual(['way/4']);
  expect(result.elements.find((e) => e.id === 4)?.tags).toEqual({
    man_made: 'water_tower',
    height: '30',
    building: 'yes',
    name: 'Имя из нового набора',
  });
});

it('не добавляет башню за границей покрытия тайла', () => {
  // Arrange
  const far = { south: 60, north: 61, west: 31, east: 32 };
  // Act
  const result = recoverTowerElements([], [...nodes, tower], far);
  // Assert
  expect(result.recovered).toHaveLength(0);
});

it('останавливает восстановление при неполной геометрии источника', () => {
  // Arrange
  const incomplete = [nodes[0], tower];
  // Act / Assert
  expect(() => recoverTowerElements([], incomplete, bounds)).toThrow('node/2');
});

it('сохраняет явные данные тайла при частичном дополнении источника', () => {
  // Arrange
  const existing = [
    ...nodes,
    { ...tower, tags: { man_made: 'water_tower', height: '35' } },
  ];
  const source = [
    ...nodes,
    { ...tower, tags: { ...tower.tags, 'building:levels': '3' } },
  ];
  // Act
  const result = recoverTowerElements(existing, source, bounds);
  // Assert
  expect(result.elements.find((e) => e.id === 4)?.tags?.height).toBe('35');
  expect(
    result.elements.find((e) => e.id === 4)?.tags?.['building:levels'],
  ).toBe('3');
});

it.each(['missing', 'complete', 'stale', 'unknown'] as const)(
  'аудит эффективного слоя: %s',
  async (state) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'tower-audit-'));
    try {
      const tile = latLonToSourceTile(59, 30),
        tileKey = sourceTileKey(tile),
        path = `${tileKey}.tile.json.br`,
        local = join(directory, 'overlay'),
        sourceFile = join(directory, 'source.json'),
        output = join(directory, 'output');
      const preserved: OSMElement = {
        type: 'node',
        id: 99,
        lat: 59,
        lon: 30,
        tags: { name: 'Новый слой' },
      };
      const serialized = encodeTileArtifact({
        schemaVersion: 1,
        tileBuildVersion: TILE_BUILD_VERSION,
        ...tile,
        coreBounds: sourceTileBounds(tile),
        bufferedBounds: bounds,
        generatedAt: '2026-09-11T10:00:00Z',
        osmTimestamp: '2026-09-11T00:30:01Z',
        drivingSide: 'right',
        elements:
          state === 'complete' ? [preserved, ...nodes, tower] : [preserved],
        elevation: {
          width: 2,
          size: 700,
          values: new Float32Array([1, 2, 3, 4]),
        },
      });
      const compressed = brotliCompressSync(Buffer.from(serialized));
      await mkdir(join(local, String(tile.z), String(tile.x)), {
        recursive: true,
      });
      await writeFile(join(local, path), compressed);
      await writeFile(
        sourceFile,
        JSON.stringify({ elements: [...nodes, tower] }),
      );
      const descriptor = {
        checksum: JSON.parse(serialized).checksum,
        bytes: compressed.length,
      };
      const fetcher = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              activeDatasets: ['overlay', 'base'],
              datasets: [
                {
                  datasetId: 'base',
                  path: 'base',
                  tiles: { [tileKey]: { ...descriptor, checksum: 'outdated' } },
                },
                {
                  datasetId: 'overlay',
                  path: 'overlay',
                  tiles: { [tileKey]: descriptor },
                },
              ],
            }),
          ),
      );
      vi.stubGlobal('fetch', fetcher);
      const config = {
        baseUrl: 'https://example.test',
        localRoots: { overlay: local },
        sources: [
          {
            file: sourceFile,
            timestamp:
              state === 'unknown'
                ? 'unknown'
                : state === 'stale'
                  ? '2026-09-10T00:00:00Z'
                  : '2026-09-11T00:30:01Z',
          },
        ],
      };
      // Act / Assert
      if (state === 'unknown') {
        await expect(auditTowerTiles(config, output)).rejects.toThrow(
          'Некорректная дата источника',
        );
      } else if (state === 'stale') {
        await expect(auditTowerTiles(config, output)).rejects.toThrow(
          'Источник старее тайла',
        );
      } else {
        const report = await auditTowerTiles(config, output);
        expect(report.checkedTiles).toBe(1);
        expect(report.changedTiles).toBe(state === 'missing' ? 1 : 0);
        const manifest = JSON.parse(
          await readFile(join(output, 'staging-manifest-v1.json'), 'utf8'),
        );
        expect(Object.keys(manifest.tiles)).toEqual(
          state === 'missing' ? [tileKey] : [],
        );
        if (state === 'missing') {
          expect(report.changed[0].dataset).toBe('overlay');
          const restored = decodeTileArtifact(
            new TextDecoder().decode(
              brotliDecompressSync(await readFile(join(output, path))),
            ),
            tile,
          );
          expect(restored.elements).toEqual([preserved, tower, ...nodes]);
          expect([...restored.elevation.values]).toEqual([1, 2, 3, 4]);
          expect(restored.osmTimestamp).toBe('2026-09-11T00:30:01Z');
          expect(restored.checksum).toBe(manifest.tiles[tileKey].checksum);
        }
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
