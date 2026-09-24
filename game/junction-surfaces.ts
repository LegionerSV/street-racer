import { CURB_WIDTH, SIDEWALK_WIDTH } from './clearance';
import { distance2 } from './geo';
import type { Edge, Point } from './types';

function hull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (list: Point[]) => {
    const result: Point[] = [];
    for (const p of list) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, p) <= 0)
        result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

export function junctionSurfaces(edges: Edge[]): Point[][] {
  const nodes = new Map<
    number,
    { point: Point; width: number; links: Set<number> }
  >();
  for (const e of edges) {
    if (e.bridge || e.tunnel || e.tunnelApproach || e.roundabout || e.passage)
      continue;
    for (const [id, other, p] of [
      [e.from, e.to, e.points[0]],
      [e.to, e.from, e.points.at(-1)!],
    ] as const) {
      const node = nodes.get(id) || {
        point: p,
        width: 0,
        links: new Set<number>(),
      };
      node.width = Math.max(node.width, e.width);
      node.links.add(other);
      nodes.set(id, node);
    }
  }
  const links = new Map<number, Set<number>>();
  for (const e of edges) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to);
    if (
      !a ||
      !b ||
      a.links.size < 3 ||
      b.links.size < 3 ||
      e.roundabout ||
      e.bridge ||
      e.tunnel ||
      e.tunnelApproach ||
      e.passage ||
      e.length > 2 * Math.max(a.width, b.width) ||
      Math.abs(a.point.y - b.point.y) > 0.25
    )
      continue;
    for (const [id, other] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      const neighbours = links.get(id) || new Set<number>();
      neighbours.add(other);
      links.set(id, neighbours);
    }
  }
  const seen = new Set<number>(),
    surfaces: Point[][] = [];
  for (const first of links.keys()) {
    if (seen.has(first)) continue;
    const group: number[] = [],
      pending = [first];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      group.push(id);
      pending.push(...(links.get(id) || []));
    }
    if (group.length < 3 || group.some((id) => (links.get(id)?.size || 0) < 2))
      continue;
    const members = group.map((id) => nodes.get(id)!);
    const diameter =
      2 * Math.max(...members.map((n) => n.width)) +
      2 * (SIDEWALK_WIDTH + CURB_WIDTH);
    if (
      members.some((a) =>
        members.some(
          (b) =>
            distance2(a.point, b.point) > diameter ||
            Math.abs(a.point.y - b.point.y) > 0.25,
        ),
      )
    )
      continue;
    const y = members.reduce((sum, n) => sum + n.point.y, 0) / members.length;
    surfaces.push(
      hull(
        members.flatMap((n) =>
          Array.from({ length: 12 }, (_, i) => ({
            x: n.point.x + (Math.cos((i * Math.PI) / 6) * n.width) / 2,
            z: n.point.z + (Math.sin((i * Math.PI) / 6) * n.width) / 2,
            y,
          })),
        ),
      ),
    );
  }
  return surfaces;
}
