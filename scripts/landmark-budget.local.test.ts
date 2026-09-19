import { it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { appendBuilding } from '../game/buildings';
import { buildWorld } from '../game/network';
import { desiredChunks, indexWorld } from '../game/chunks';
import { startupTiles, mapStreamingPolicy } from '../game/region-stream';
import { reduceMapElements } from '../game/map-element-filter';
import { parseSourceTileKey, sourceTileCenter } from '../game/source-tiles';
import type { MeshData, OSMElement } from '../game/types';
import moscow from '../game/fixtures/landmarks/moscow.json';
import petersburg from '../game/fixtures/landmarks/saint-petersburg.json';

const mesh = (): MeshData => ({ positions: [], indices: [], colors: [] });
const region = (
  center: { lat: number; lon: number },
  elements: OSMElement[],
) => ({
  center,
  elements,
  elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  drivingSide: 'right' as const,
  fetchedAt: 'test',
});

it('геометрия реальных ансамблей укладывается в 30 тысяч треугольников, вдали дешевле', () => {
  const rows = [];
  let cheaper = 0;
  for (const scenario of [...moscow, ...petersburg].filter((s) => s.complex)) {
    // Arrange
    const world = buildWorld(
      region(
        scenario.center,
        reduceMapElements(scenario.elements as OSMElement[], scenario.center)
          .elements,
      ),
    );
    const geometries = [];
    // Act
    for (const lod of [0, 2]) {
      const start = performance.now(),
        meshes = [mesh(), mesh(), mesh(), mesh(), mesh()];
      for (const b of world.buildings)
        appendBuilding(b, lod, meshes[0], meshes.slice(1));
      if (process.env.LANDMARK_PROFILE && lod === 0)
        writeFileSync(
          `work/landmark-inventory/preview-${scenario.key.replace('/', '-')}.json`,
          JSON.stringify(meshes),
        );
      geometries.push({
        lod,
        triangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0),
        bytes: meshes.reduce(
          (n, m) =>
            n +
            (m.positions.length * 2 +
              (m.colors?.length || 0) +
              (m.uvs?.length || 0) +
              m.indices.length) *
              4,
          0,
        ),
        ms: Math.round(performance.now() - start),
      });
    }
    // Assert
    expect(geometries[0].triangles, scenario.key).toBeLessThan(30000);
    expect(geometries[1].triangles, scenario.key).toBeLessThanOrEqual(
      geometries[0].triangles,
    );
    if (geometries[1].triangles < geometries[0].triangles) cheaper++;
    rows.push({
      key: scenario.key,
      name: scenario.name,
      buildings: world.buildings.length,
      geometries,
    });
  }
  expect(cheaper).toBeGreaterThan(0);
  if (process.env.LANDMARK_PROFILE) {
    mkdirSync('work/landmark-inventory', { recursive: true });
    writeFileSync(
      'work/landmark-inventory/geometry-cost.json',
      JSON.stringify(rows, null, 2),
    );
  }
});

it.skipIf(
  !existsSync('work/map-pilots/moscow/staging-manifest-v1.json') ||
    !existsSync('work/map-pilots/saint-petersburg/staging-manifest-v1.json'),
)(
  'полное стартовое покрытие обоих городов сохраняет дороги, зависимости и мобильный лимит',
  () => {
    const rows = [];
    for (const [city, center] of [
      ['moscow', { lat: 55.753, lon: 37.621 }],
      ['saint-petersburg', { lat: 59.9343, lon: 30.3351 }],
    ] as const) {
      // Arrange
      const policy = mapStreamingPolicy('mobile'),
        keys = startupTiles(center, policy.blockingRadiusMeters);
      const manifest = JSON.parse(
        readFileSync(
          `work/map-pilots/${city}/staging-manifest-v1.json`,
          'utf8',
        ),
      );
      const raw = new Map<string, OSMElement>(),
        kept = new Map<string, OSMElement>();
      let mode = 'standard';
      const modeCounts: Record<string, number> = {};
      const start = performance.now();
      // Act: все стартовые клетки, без сокращения радиуса.
      for (const detail of ['standard', 'minimal'] as const) {
        kept.clear();
        mode = detail;
        for (const key of keys) {
          expect(manifest.tiles[key], key).toBeDefined();
          const tile = JSON.parse(
            brotliDecompressSync(
              readFileSync(
                `work/map-pilots/${city}/${manifest.tiles[key].path}`,
              ),
            ).toString(),
          );
          for (const e of tile.elements) raw.set(`${e.type}/${e.id}`, e);
          for (const e of reduceMapElements(
            tile.elements,
            sourceTileCenter(parseSourceTileKey(key)),
            detail,
          ).elements)
            kept.set(`${e.type}/${e.id}`, e);
        }
        modeCounts[detail] = kept.size;
        if (kept.size <= policy.maxElements) break;
      }
      // Assert
      expect(kept.size).toBeLessThanOrEqual(policy.maxElements);
      for (const e of kept.values()) {
        for (const id of e.nodes || [])
          expect(kept.has(`node/${id}`)).toBe(true);
        for (const m of e.members || [])
          if (raw.has(`${m.type}/${m.ref}`))
            expect(kept.has(`${m.type}/${m.ref}`)).toBe(true);
      }
      for (const e of raw.values())
        if (
          e.tags?.highway &&
          e.type === 'way' &&
          e.tags.highway !== 'service' &&
          [
            'residential',
            'primary',
            'secondary',
            'tertiary',
            'trunk',
            'motorway',
            'unclassified',
            'living_street',
          ].includes(e.tags.highway) &&
          !['no', 'private'].includes(e.tags.access) &&
          e.tags.motor_vehicle !== 'no' &&
          e.tags.motorcar !== 'no' &&
          e.tags.area !== 'yes'
        )
          expect(kept.has(`way/${e.id}`)).toBe(true);
      // Строительная геометрия отдельно от дорожной/рельефной, с тем же владением кварталами.
      const world = buildWorld(
        region(
          center,
          [...kept.values()].filter((e) => !e.tags?.highway),
        ),
      );
      const index = indexWorld(world),
        plans = desiredChunks({ x: 0, y: 0, z: 0 }, 0, 'mobile');
      let triangles = 0,
        bytes = 0,
        maxChunk = 0;
      for (const plan of plans) {
        const meshes = [mesh(), mesh(), mesh(), mesh(), mesh()];
        for (const b of index.buildings.get(plan.key) || [])
          appendBuilding(b, plan.lod, meshes[0], meshes.slice(1));
        const count = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
        maxChunk = Math.max(maxChunk, count);
        triangles += count;
        bytes += meshes.reduce(
          (n, m) =>
            n +
            (m.positions.length * 2 +
              (m.colors?.length || 0) +
              (m.uvs?.length || 0) +
              m.indices.length) *
              4,
          0,
        );
      }
      expect(triangles).toBeLessThan(200000);
      expect(bytes).toBeLessThan(32 * 1024 * 1024);
      rows.push({
        city,
        mode,
        modeCounts,
        tiles: keys.length,
        raw: raw.size,
        kept: kept.size,
        buildings: world.buildings.length,
        chunks: plans.length,
        triangles,
        maxChunk,
        bytes,
        ms: Math.round(performance.now() - start),
      });
    }
    if (process.env.LANDMARK_PROFILE)
      writeFileSync(
        'work/landmark-inventory/mobile-cost.json',
        JSON.stringify(rows, null, 2),
      );
  },
  60000,
);
