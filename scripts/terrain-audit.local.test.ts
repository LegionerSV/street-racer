import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { buildWorld } from '../game/network';
import { distance2 } from '../game/geo';
import type { ElevationGrid, RegionData } from '../game/types';
import { createDemElevationSource } from './local-map-data';
import { TERRAIN_GRID_SIZE, TERRAIN_GRID_WIDTH } from '../game/terrain-policy';

it.skipIf(!process.env.TERRAIN_AUDIT)(
  'проверяет полный локальный контекст Петербурга и другой город без сети',
  async () => {
    // Arrange — только существующий архив OSM и кэш Terrarium.
    const region: RegionData = JSON.parse(
      brotliDecompressSync(
        readFileSync('game/fixtures/nevsky-video.json.br'),
      ).toString(),
    );
    const convert = (g: ElevationGrid): ElevationGrid => ({
      ...g,
      values: Float32Array.from(g.values),
      patches: g.patches?.map(convert),
    });
    region.elevation = convert(
      JSON.parse(
        brotliDecompressSync(
          readFileSync('game/fixtures/nevsky-wide-elevation.json.br'),
        ).toString(),
      ),
    );
    region.elements = JSON.parse(
      readFileSync('work/terrain-objects.json', 'utf8'),
    );
    // Act
    const started = performance.now(),
      world = buildWorld(region),
      elapsed = performance.now() - started;
    const edges = world.edges.filter((e) => e.name === 'Невский проспект'),
      points = edges
        .flatMap((e) => e.points)
        .filter((p) => Math.abs(p.x) < 1100 && Math.abs(p.z) < 350);
    const range =
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    const grade = Math.max(
      ...edges.flatMap((e) =>
        e.points
          .slice(1)
          .map(
            (p, i) => Math.abs(p.y - e.points[i].y) / distance2(p, e.points[i]),
          ),
      ),
    );
    const report: Record<string, unknown> = {
      petersburg: {
        objects: region.elements.length,
        edges: world.edges.length,
        buildings: world.buildings.length,
        points: points.length,
        range,
        grade,
        buildMs: elapsed,
      },
    };
    writeFileSync(
      'work/terrain-audit-result.json',
      JSON.stringify(report, null, 2),
    );
    // Assert
    expect(points.length).toBeGreaterThan(500);
    expect(range).toBeLessThan(1);
    expect(grade).toBeLessThan(0.08);
    expect(edges.filter((e) => e.blocked && !e.unloaded)).toEqual([]);

    // Arrange — независимая сохранённая геометрия Москвы и тот же алгоритм.
    const dem = createDemElevationSource({
      cache: 'work/map-cache/terrarium',
      downloadMissing: false,
    });
    const center = { lat: 55.745, lon: 37.6135 };
    const elevation = await dem(center, new AbortController().signal, {
      size: TERRAIN_GRID_SIZE,
      width: TERRAIN_GRID_WIDTH,
      offsetX: 0,
      offsetZ: 0,
    });
    const elements = JSON.parse(
      readFileSync('game/fixtures/moscow-bridge.osm.json', 'utf8'),
    ).elements;
    // Act
    const moscow = buildWorld({
      center,
      elements,
      elevation,
      drivingSide: 'right',
      fetchedAt: 'local-archive',
    });
    const oldGrid = JSON.parse(
      readFileSync('game/fixtures/moscow-elevation.json', 'utf8'),
    );
    const baseline = buildWorld({
      center,
      elements,
      elevation: convert(oldGrid),
      drivingSide: 'right',
      fetchedAt: 'local-archive',
    });
    report.moscow = {
      edges: moscow.edges.length,
      bridges: moscow.edges.filter((e) => e.bridge).length,
      blocked: moscow.edges
        .filter((e) => e.blocked)
        .map((e) => ({
          way: e.way,
          reasons: e.blockedReasons,
          issue: e.clearanceIssue,
        })),
      baselineBlocked: baseline.edges
        .filter((e) => e.blocked)
        .map((e) => ({
          way: e.way,
          reasons: e.blockedReasons,
          issue: e.clearanceIssue,
        })),
    };
    writeFileSync(
      'work/terrain-audit-result.json',
      JSON.stringify(report, null, 2),
    );
    // Assert
    expect(moscow.edges.length).toBeGreaterThan(0);
    expect(
      moscow.edges.flatMap((e) => e.points).every((p) => Number.isFinite(p.y)),
    ).toBe(true);
    // В архиве уже есть блокировки мостовых подходов. Смена DEM не должна
    // добавлять новые; полное отсутствие блокировок проверяется выше на Невском.
    const blockedBridges = (w: typeof moscow) =>
      w.edges
        .filter((e) => e.bridge && !e.unloaded && e.blocked)
        .map((e) => ({ id: e.stableId, reasons: e.blockedReasons }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(blockedBridges(moscow)).toEqual(blockedBridges(baseline));
  },
  120000,
);
