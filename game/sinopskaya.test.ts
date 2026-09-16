import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { projectOnSegment, toGeo } from './geo';
import { reconcileWorld } from './world-update';
import {
  buildIncrementalWorld,
  SourceTileRegistry,
} from './source-tile-registry';
import { latLonToSourceTile, sourceTileKey } from './source-tiles';
import type { ElevationGrid, RegionData } from './types';

function region(): RegionData {
  const data = JSON.parse(
    brotliDecompressSync(
      readFileSync(new URL('./fixtures/sinopskaya.json.br', import.meta.url)),
    ).toString(),
  );
  const restore = (grid: ElevationGrid): ElevationGrid => ({
    ...grid,
    values: Float32Array.from(grid.values),
    patches: grid.patches?.map(restore),
  });
  return { ...data, elevation: restore(data.elevation) };
}

it('соседние направления Синопской набережной имеют общий поперечный уровень до и после обновления карты', () => {
  // Arrange — сохранённые OSM и DEM из того же набора тайлов, что в отчёте пользователя.
  const input = region();
  // Act
  const world = buildWorld(input);
  const updated = reconcileWorld(
    world,
    buildWorld({
      ...input,
      elements: [...input.elements].reverse(),
      heightDatum: world.heightDatum,
    }),
  );
  const sourceTiles = input.elevation.patches!.map((elevation) => {
    const center = toGeo(
      { x: elevation.offsetX!, y: 0, z: elevation.offsetZ! },
      input.center,
    );
    return {
      key: sourceTileKey(latLonToSourceTile(center.lat, center.lon)),
      elevation,
      elements: input.elements,
    };
  });
  const registry = SourceTileRegistry.fromRegion({ ...input, sourceTiles })!;
  const streamedRegion = registry.regionFor(registry.keys(), input),
    streamed = buildWorld(streamedRegion);
  const replacement = {
    ...sourceTiles[0],
    elements: [
      ...sourceTiles[0].elements,
      {
        type: 'node' as const,
        id: 900000000001,
        lat: input.center.lat,
        lon: input.center.lon,
      },
    ],
  };
  const staged = registry.stageUpdate([replacement], []);
  const incremental = buildIncrementalWorld(
    streamed,
    staged.registry,
    staged.registry.affectedTiles(staged.changed, staged.changedElements),
    streamedRegion,
    staged.changedElements,
  );
  // Assert — точки в районе автомобиля, вдоль обоих соседних фрагментов OSM way.
  for (const current of [world, updated, streamed, incremental]) {
    const opposite = current.edges.filter((e) => e.way === 317407182);
    let checked = 0;
    for (const e of current.edges.filter((e) =>
      [1461352095, 1461352096].includes(e.way),
    ))
      for (const p of e.points) {
        if (p.z < 680 || p.z > 745) continue;
        const nearest = opposite
          .flatMap((e) =>
            e.points
              .slice(1)
              .map((b, i) => projectOnSegment(p, e.points[i], b)),
          )
          .sort((a, b) => a.distance - b.distance)[0];
        expect(Math.abs(p.y - nearest.point.y), `z=${p.z}`).toBeLessThan(0.15);
        checked++;
      }
    expect(checked).toBeGreaterThan(5);
  }
}, 10000);
