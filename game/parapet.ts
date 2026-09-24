import { distance2 } from './geo';
import type { MeshData, Point } from './types';

export const PARAPET_COLOUR: [number, number, number] = [0.46, 0.44, 0.41];

export function appendParapet(
  mesh: MeshData,
  a: Point,
  b: Point,
  side: number,
  na?: { x: number; z: number },
  nb?: { x: number; z: number },
) {
  const length = distance2(a, b);
  if (length < 0.001) return;
  const nx = ((b.z - a.z) / length) * side;
  const nz = (-(b.x - a.x) / length) * side;
  const face = (points: Point[], colour: number[]) => {
    const base = mesh.positions.length / 3;
    for (const p of points) {
      mesh.positions.push(p.x, p.y, p.z);
      mesh.colors!.push(...colour, 1);
    }
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [bottom, top, width, tone] of [
    [0, 0.16, 0.6, 0.92],
    [0.16, 0.94, 0.46, 1],
    [0.94, 1.1, 0.6, 1.14],
  ]) {
    const at = (p: Point, offset: number, height: number) => {
      const normal = p === a ? na : nb;
      return {
        x: p.x + (normal ? normal.x * side : nx) * offset,
        y: p.y + height,
        z: p.z + (normal ? normal.z * side : nz) * offset,
      };
    };
    const aa = at(a, 0, bottom),
      bb = at(b, 0, bottom);
    const cc = at(b, width, bottom),
      dd = at(a, width, bottom);
    const au = at(a, 0, top),
      bu = at(b, 0, top);
    const cu = at(b, width, top),
      du = at(a, width, top);
    const colour = PARAPET_COLOUR.map((value) => value * tone);
    for (const points of [
      [aa, bb, bu, au],
      [bb, cc, cu, bu],
      [cc, dd, du, cu],
      [dd, aa, au, du],
      [au, bu, cu, du],
    ])
      face(points, colour);
  }
}
