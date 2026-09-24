import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { ASPHALT_COLOUR } from './surface-textures';
import {
  boundsOf,
  footprintPrism,
  roadPrism,
  SpatialGrid,
  subtractPrisms,
  type Prism,
} from './geometry';
import { resample } from './geo';
import type { Edge, MeshData, Point, World } from './types';

const area = (points: Point[]) =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.z - q.x * p.z;
    }, 0),
  ) / 2;
const triangleAt = (mesh: MeshData, i: number) =>
  mesh.indices
    .slice(i, i + 3)
    .map((id) => ({
      x: mesh.positions[id * 3],
      y: mesh.positions[id * 3 + 1],
      z: mesh.positions[id * 3 + 2],
    }));

it.each([0, 1, 2])(
  'земля и откосы не перекрывают площадь асфальта на пересечении и границе кварталов, LOD %s',
  (lod) => {
    // Arrange — откос высокой дороги пересекает нижнюю; проверяем площадь треугольников целиком.
    const edge = (id: number, a: Point, b: Point): Edge => ({
      id,
      stableId: String(id),
      way: id,
      from: id * 2,
      to: id * 2 + 1,
      points: resample([a, b], 10),
      name: 'Улица',
      category: 'residential',
      width: 10,
      lanes: 2,
      speed: 15,
      length: 150,
      layer: 0,
      bridge: false,
      tunnel: false,
      blocked: false,
    });
    const edges = [
      edge(1, { x: 180, y: 3, z: 242 }, { x: 320, y: 3, z: 255 }),
      edge(2, { x: 180, y: 0.12, z: 255 }, { x: 320, y: 0.12, z: 242 }),
    ];
    const world: World = {
      center: { lat: 0, lon: 0 },
      edges,
      nodes: [],
      buildings: [],
      areas: [],
      trees: [],
      restrictions: [],
      routes: [],
      warnings: [],
      spawnEdge: null,
      drivingSide: 'right',
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    };
    const masks = new SpatialGrid<Prism>();
    for (const e of edges)
      for (let i = 1; i < e.points.length; i++) {
        const mask = roadPrism(
          e.points[i - 1],
          e.points[i],
          e.width - 0.1,
          -0.01,
          1000,
        );
        masks.add(mask, mask.bounds);
      }
    let triangles = 0;
    // Act / Assert — в том числе соседние кварталы и все уровни детализации.
    for (const key of ['0,0', '1,0', '0,1', '1,1']) {
      const chunk = buildChunk(world, key, lod);
      for (const mesh of [chunk.terrain, chunk.shoulders])
        for (let i = 0; i < mesh.indices.length; i += 3) {
          const triangle = mesh.indices
            .slice(i, i + 3)
            .map((id) => ({
              x: mesh.positions[id * 3],
              y: mesh.positions[id * 3 + 1],
              z: mesh.positions[id * 3 + 2],
            }));
          const cuts = masks.query(boundsOf(triangle));
          const remaining = subtractPrisms(triangle, cuts).reduce(
            (sum, piece) => sum + area(piece),
            0,
          );
          expect(
            area(triangle) - remaining,
            `${key}: треугольник перекрывает проезжую часть`,
          ).toBeLessThan(1e-5);
          triangles++;
        }
    }
    expect(triangles).toBeGreaterThan(100);
  },
);

it.each([0, 1, 2])(
  'защищает фактическую площадь асфальта на внешнем углу поворота, LOD %s',
  (lod) => {
    // Arrange — прямоугольные маски сегментов не покрывают внешний угол (245,255).
    const edge = (id: number, points: Point[]): Edge => ({
      id,
      stableId: String(id),
      way: id,
      from: id * 2,
      to: id * 2 + 1,
      points: resample(points, 10),
      name: 'Улица',
      category: 'residential',
      width: 10,
      lanes: 2,
      speed: 15,
      length: 150,
      layer: 0,
      bridge: false,
      tunnel: false,
      blocked: false,
    });
    const world: World = {
      center: { lat: 0, lon: 0 },
      edges: [
        edge(1, [
          { x: 250, y: 0.12, z: 190 },
          { x: 250, y: 0.12, z: 250 },
          { x: 310, y: 0.12, z: 250 },
        ]),
        edge(2, [
          { x: 180, y: 3, z: 263 },
          { x: 320, y: 3, z: 263 },
        ]),
      ],
      nodes: [],
      buildings: [],
      areas: [],
      trees: [],
      restrictions: [],
      routes: [],
      warnings: [],
      spawnEdge: null,
      drivingSide: 'right',
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    };
    // Act
    const chunks = ['0,0', '1,0', '0,1', '1,1'].map((key) =>
      buildChunk(world, key, lod),
    );
    const masks = new SpatialGrid<Prism>();
    let roads = 0;
    for (const { road } of chunks)
      for (let i = 0; i < road.indices.length; i += 3) {
        if (road.colors![road.indices[i] * 4] !== ASPHALT_COLOUR[0]) continue;
        const triangle = triangleAt(road, i),
          [a, b, c] = triangle;
        if (area(triangle) < 1e-8) continue;
        // Независимо строим плоскость по готовым вершинам, не по исходным осям дорог.
        const ux = b.x - a.x,
          uy = b.y - a.y,
          uz = b.z - a.z,
          vx = c.x - a.x,
          vy = c.y - a.y,
          vz = c.z - a.z;
        const ny = uz * vx - ux * vz,
          nx = (uy * vz - uz * vy) / ny,
          nz = (ux * vy - uy * vx) / ny;
        const mask = footprintPrism(
          triangle,
          { x: nx, y: 1, z: nz, w: -a.y - nx * a.x - nz * a.z },
          -0.001,
          1000,
        );
        masks.add(mask, mask.bounds);
        roads++;
      }
    // Assert — проверяем все треугольники земли/откосов против готового асфальта.
    for (const chunk of chunks)
      for (const mesh of [chunk.terrain, chunk.shoulders])
        for (let i = 0; i < mesh.indices.length; i += 3) {
          const triangle = triangleAt(mesh, i),
            remaining = subtractPrisms(
              triangle,
              masks.query(boundsOf(triangle)),
            ).reduce((sum, piece) => sum + area(piece), 0);
          expect(
            area(triangle) - remaining,
            `${chunk.key}: выступ на повороте`,
          ).toBeLessThan(1e-5);
        }
    expect(roads).toBeGreaterThan(30);
    expect(
      chunks.reduce((sum, c) => sum + c.shoulders.indices.length, 0),
    ).toBeGreaterThan(30);
  },
);
