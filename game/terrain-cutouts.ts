import {
  boundsOf,
  subtractPrisms,
  type SpatialGrid,
  type Prism,
} from './geometry';
import type { MeshData } from './types';

// Одна геометрия поступает и в отрисовку, и в Havok. Вырезаем только объём
// свободного проезда: поверхность над крышей и соседние склоны сохраняются.
export function cutSoil(mesh: MeshData, cavities: SpatialGrid<Prism>) {
  const indices: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3);
    const triangle = ids.map((id, j) => ({
      x: mesh.positions[id * 3],
      y: mesh.positions[id * 3 + 1],
      z: mesh.positions[id * 3 + 2],
      u: j === 0 ? 1 : 0,
      v: j === 1 ? 1 : 0,
    }));
    const masks = cavities.query(boundsOf(triangle));
    const pieces = masks.length ? subtractPrisms(triangle, masks) : [triangle];
    if (pieces.length === 1 && pieces[0] === triangle) {
      indices.push(...ids);
      continue;
    }
    for (const piece of pieces) {
      const base = mesh.positions.length / 3;
      for (const p of piece) {
        mesh.positions.push(p.x, p.y, p.z);
        if (mesh.colors) {
          const weights = [p.u!, p.v!, 1 - p.u! - p.v!];
          for (let c = 0; c < 4; c++)
            mesh.colors.push(
              ids.reduce(
                (sum, id, j) => sum + mesh.colors![id * 4 + c] * weights[j],
                0,
              ),
            );
        }
      }
      for (let j = 1; j < piece.length - 1; j++)
        indices.push(base, base + j, base + j + 1);
    }
  }
  mesh.indices = indices;
}
