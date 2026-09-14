import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { buildWorld } from './network';
import { distance2, tileKey, mixPoint } from './geo';
import type { ElevationGrid, RegionData, MeshData, Point } from './types';
import { buildChunk } from './chunks';
import { roadCrossings } from './clearance';

function fixture(): RegionData {
  const input = JSON.parse(
    brotliDecompressSync(
      readFileSync(new URL('./fixtures/nevsky-video.json.br', import.meta.url)),
    ).toString(),
  );
  const grid = (g: ElevationGrid): ElevationGrid => ({
    ...g,
    values: Float32Array.from(g.values),
    patches: g.patches?.map(grid),
  });
  // Те же дороги и источник Terrarium; дополнительный запас соответствует
  // новой форме runtime-запроса. Исходная узкая фикстура сохранена отдельно.
  input.elevation = JSON.parse(
    brotliDecompressSync(
      readFileSync(
        new URL('./fixtures/nevsky-wide-elevation.json.br', import.meta.url),
      ),
    ).toString(),
  );
  return { ...input, elevation: grid(input.elevation) };
}
it('Невский в центре не превращается в холмы и сохраняет проезжаемые стыки', () => {
  // Arrange — реальные OSM и DEM из локального архива, без сети.
  const input = fixture();
  // Act
  const world = buildWorld(input),
    edges = world.edges.filter((e) => e.name === 'Невский проспект');
  const points = edges
    .flatMap((e) => e.points)
    .filter((p) => Math.abs(p.x) < 1100 && Math.abs(p.z) < 350);
  if (process.env.NEVSKY_REPORT) {
    const segments = edges
      .flatMap((edge) =>
        edge.points.slice(1).map((p, i) => ({
          way: edge.way,
          bridge: edge.bridge,
          distance: distance2(p, edge.points[i]),
          rise: p.y - edge.points[i].y,
        })),
      )
      .filter((s) => s.distance > 1e-6);
    console.log({
      points: points.length,
      range:
        Math.max(...points.map((p) => p.y)) -
        Math.min(...points.map((p) => p.y)),
      steepest: segments
        .sort(
          (a, b) =>
            Math.abs(b.rise / b.distance) - Math.abs(a.rise / a.distance),
        )
        .slice(0, 5),
    });
  }
  // Assert — игровой допуск, не геодезическое измерение отметок полотна.
  expect(edges.length).toBeGreaterThan(100);
  expect
    .soft(
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
    )
    .toBeLessThan(1);
  expect
    .soft(
      Math.max(
        ...edges.flatMap((e) =>
          e.points
            .slice(1)
            .map(
              (p, i) =>
                Math.abs(p.y - e.points[i].y) / distance2(p, e.points[i]),
            ),
        ),
      ),
    )
    .toBeLessThan(0.08);
  expect.soft(edges.filter((e) => e.blocked && !e.unloaded)).toEqual([]);
  expect
    .soft(
      roadCrossings(world.edges).filter(
        (c) => c.upper.edge.way === 181173664 && c.lower.edge.way === 307823510,
      ),
    )
    .toEqual([]);
});

function heightsAt(mesh: MeshData, p: Point) {
  const values: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map((id) => ({
      x: mesh.positions[id * 3],
      y: mesh.positions[id * 3 + 1],
      z: mesh.positions[id * 3 + 2],
    }));
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-8) continue;
    const u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / d;
    const v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / d;
    if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7)
      values.push(u * a.y + v * b.y + (1 - u - v) * c.y);
  }
  return values;
}
it('на пути по Невскому нет поднятых тротуаров и земли внутри проезжей части', () => {
  // Arrange
  const world = buildWorld(fixture());
  const edges = world.edges.filter(
    (e) =>
      e.name === 'Невский проспект' &&
      !e.blocked &&
      e.points.every((p) => Math.abs(p.x) < 1000 && Math.abs(p.z) < 300),
  );
  const chunks = new Map<string, ReturnType<typeof buildChunk>>();
  let checked = 0;
  // Act / Assert — поперечные образцы покрытия в реальных кварталах записи.
  for (const e of edges) {
    const a = e.points[0],
      b = e.points.at(-1)!,
      length = distance2(a, b);
    if (length < 8) continue;
    const center = mixPoint(a, b, 0.5),
      nx = (b.z - a.z) / length,
      nz = -(b.x - a.x) / length;
    for (const offset of [-e.width / 2 + 1.5, 0, e.width / 2 - 1.5]) {
      const p = {
        ...center,
        x: center.x + nx * offset,
        z: center.z + nz * offset,
      };
      const key = tileKey(center.x, center.z);
      if (!chunks.has(key)) chunks.set(key, buildChunk(world, key, 0));
      const chunk = chunks.get(key)!;
      for (const mesh of [chunk.terrain, chunk.shoulders, chunk.sidewalks!]) {
        const obstacles = heightsAt(mesh, p).filter(
          (y) => y > center.y + 0.25 && y < center.y + 2,
        );
        expect(obstacles, `OSM ${e.way}: препятствие внутри дороги`).toEqual(
          [],
        );
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(150);
}, 30000);
