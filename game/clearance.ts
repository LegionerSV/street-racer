import type { Edge, Point } from './types';

// Пространственный индекс ограничивает проверку соседними сегментами вместо всех пар дорог.
export function validateClearance(edges: Edge[]): string[] {
  type Segment = { edge: Edge; a: Point; b: Point; id: number };
  const cells = new Map<string, Segment[]>(), segments: Segment[] = [], seen = new Set<string>();
  const keys = (a: Point, b: Point) => {
    const result: string[] = [];
    for (let x = Math.floor(Math.min(a.x, b.x) / 50); x <= Math.floor(Math.max(a.x, b.x) / 50); x++)
      for (let z = Math.floor(Math.min(a.z, b.z) / 50); z <= Math.floor(Math.max(a.z, b.z) / 50); z++) result.push(`${x},${z}`);
    return result;
  };
  for (const edge of edges) {
    const key = `${edge.way}:${Math.min(edge.from, edge.to)}:${Math.max(edge.from, edge.to)}`;
    if (edge.blocked || seen.has(key)) continue; seen.add(key);
    for (let i = 1; i < edge.points.length; i++) {
      const segment = { edge, a: edge.points[i - 1], b: edge.points[i], id: segments.length }; segments.push(segment);
      for (const cell of keys(segment.a, segment.b)) { const list = cells.get(cell) || []; list.push(segment); cells.set(cell, list); }
    }
  }
  const closed = new Set<number>();
  for (const segment of segments) {
    if (!segment.edge.bridge && !segment.edge.tunnel) continue;
    const checked = new Set<number>();
    for (const key of keys(segment.a, segment.b)) for (const other of cells.get(key) || []) {
      if (checked.has(other.id)) continue; checked.add(other.id);
      const e = segment.edge, f = other.edge;
      if (e.way === f.way || [e.from, e.to].some(id => id === f.from || id === f.to)) continue;
      const a = segment.a, b = segment.b, c = other.a, d = other.b;
      const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
      const cross = rx * sz - rz * sx; if (Math.abs(cross) < .001) continue;
      const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / cross;
      const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / cross;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const delta = a.y + (b.y - a.y) * t - c.y - (d.y - c.y) * u;
      if (Math.abs(delta) < 4.5 || (e.layer !== f.layer && Math.sign(delta) !== Math.sign(e.layer - f.layer))) closed.add(e.way);
    }
  }
  for (const edge of edges) if (closed.has(edge.way)) edge.blocked = true;
  return [...closed].sort((a, b) => a - b).map(id => `Дорога ${id} закрыта: недостаточный просвет между уровнями.`);
}
