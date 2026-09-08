import {
  distance2,
  mixPoint,
  projectOnSegment,
  smoother,
  sampleRoadElevation,
} from './geo';
import type { Edge, Point, ElevationGrid } from './types';

export const BRIDGE_DECK_THICKNESS = 0.55;
export const MIN_ROAD_CLEARANCE = 3.5;
export const SIDEWALK_WIDTH = 2;
export const CURB_WIDTH = 0.2;
export const CURB_HEIGHT = 0.15;
type Segment = { edge: Edge; a: Point; b: Point; id: number };
export type RoadCrossing = {
  upper: Segment;
  lower: Segment;
  t: number;
  u: number;
};
const physicalKey = (e: Edge) =>
  `${e.way}:${Math.min(e.from, e.to)}:${Math.max(e.from, e.to)}`;
const physicalEdges = (edges: Edge[]) => [
  ...new Map(edges.map((e) => [physicalKey(e), e])).values(),
];

// Встречные полотна одного моста часто имеют разные узлы OSM.
// Связываем только соответствующие торцы близких параллельных конструкций;
// эти связи используются для геометрии, но не разрешают разворот в маршрутах.
function bridgePeers(edges: Edge[]) {
  const links = new Map<number, { id: number; distance: number }[]>();
  const cells = new Map<string, Edge[]>();
  for (const a of edges.filter((e) => e.bridge)) {
    const p = a.points[0],
      q = a.points.at(-1)!;
    const candidates = new Set<Edge>();
    for (const end of [p, q])
      for (
        let x = Math.floor(end.x / 30) - 1;
        x <= Math.floor(end.x / 30) + 1;
        x++
      )
        for (
          let z = Math.floor(end.z / 30) - 1;
          z <= Math.floor(end.z / 30) + 1;
          z++
        )
          for (const b of cells.get(`${x},${z}`) || []) candidates.add(b);
    for (const b of candidates) {
      if (
        a.way === b.way ||
        a.layer !== b.layer ||
        a.name !== b.name ||
        a.name === 'Безымянная улица'
      )
        continue;
      const r = b.points[0],
        s = b.points.at(-1)!,
        al = distance2(p, q),
        bl = distance2(r, s);
      if (
        !al ||
        !bl ||
        Math.abs(
          ((q.x - p.x) * (s.x - r.x) + (q.z - p.z) * (s.z - r.z)) / (al * bl),
        ) < 0.97
      )
        continue;
      const along = (v: Point) =>
        ((v.x - p.x) * (q.x - p.x) + (v.z - p.z) * (q.z - p.z)) / al;
      const overlap =
        Math.min(al, Math.max(along(r), along(s))) -
        Math.max(0, Math.min(along(r), along(s)));
      if (overlap < Math.min(al, bl) * 0.5) continue;
      const radius = Math.min(
        30,
        (a.width + b.width) / 2 + 2 * (SIDEWALK_WIDTH + CURB_WIDTH),
      );
      const same =
        distance2(p, r) + distance2(q, s) <= distance2(p, s) + distance2(q, r);
      const pairs = same
        ? ([
            [a.from, b.from, p, r],
            [a.to, b.to, q, s],
          ] as const)
        : ([
            [a.from, b.to, p, s],
            [a.to, b.from, q, r],
          ] as const);
      // Близости одного торца недостаточно: это может быть соседняя эстакада.
      if (pairs.some(([, , u, v]) => distance2(u, v) > radius)) continue;
      for (const [from, to, u, v] of pairs) {
        const distance = distance2(u, v);
        for (const [id, next] of [
          [from, to],
          [to, from],
        ]) {
          const list = links.get(id) || [];
          list.push({ id: next, distance });
          links.set(id, list);
        }
      }
    }
    for (const end of [p, q]) {
      const key = `${Math.floor(end.x / 30)},${Math.floor(end.z / 30)}`,
        list = cells.get(key) || [];
      list.push(a);
      cells.set(key, list);
    }
  }
  return links;
}

// Пространственный индекс ограничивает проверку соседними сегментами вместо всех пар дорог.
// Пересекаем площади полотен: на косом пересечении проверка только осей недостаточна.
export function roadCrossings(edges: Edge[]): RoadCrossing[] {
  const physical = physicalEdges(edges),
    peers = bridgePeers(physical),
    links = new Map<number, Edge[]>();
  for (const edge of physical)
    if (!edge.bridge && !edge.tunnel)
      for (const id of [edge.from, edge.to]) {
        const list = links.get(id) || [];
        list.push(edge);
        links.set(id, list);
      }
  const joins = new Map<string, { a: Point; b: Point; radius: number }[]>();
  const junctions = (a: Edge, b: Edge) => {
    const key = `${a.id}/${b.id}`,
      cached = joins.get(key);
    if (cached) return cached;
    const result: { a: Point; b: Point; radius: number }[] = [],
      radius = Math.min(
        20,
        (a.width + b.width) / 2 + 2 * (SIDEWALK_WIDTH + CURB_WIDTH),
      );
    for (const [start, point] of [
      [a.from, a.points[0]],
      [a.to, a.points.at(-1)!],
    ] as [number, Point][]) {
      const distances = new Map([[start, 0]]),
        queue = [start];
      while (queue.length) {
        const id = queue.pop()!,
          d = distances.get(id)!;
        for (const peer of peers.get(id) || []) {
          const nd = d + peer.distance;
          if (nd <= radius && nd < (distances.get(peer.id) ?? Infinity)) {
            distances.set(peer.id, nd);
            queue.push(peer.id);
          }
        }
        for (const edge of links.get(id) || []) {
          if (edge === a || edge === b) continue;
          const next = edge.from === id ? edge.to : edge.from;
          const length = edge.points
              .slice(1)
              .reduce((n, p, i) => n + distance2(p, edge.points[i]), 0),
            nd = d + length;
          if (nd <= radius && nd < (distances.get(next) ?? Infinity)) {
            distances.set(next, nd);
            queue.push(next);
          }
        }
      }
      for (const [end, other] of [
        [b.from, b.points[0]],
        [b.to, b.points.at(-1)!],
      ] as [number, Point][])
        if (distances.has(end)) result.push({ a: point, b: other, radius });
    }
    joins.set(key, result);
    return result;
  };
  const cells = new Map<string, Segment[]>(),
    segments: Segment[] = [],
    result: RoadCrossing[] = [];
  const keys = (s: Segment) => {
    const r = s.edge.width / 2 + SIDEWALK_WIDTH + CURB_WIDTH,
      keys: string[] = [];
    for (
      let x = Math.floor((Math.min(s.a.x, s.b.x) - r) / 50);
      x <= Math.floor((Math.max(s.a.x, s.b.x) + r) / 50);
      x++
    )
      for (
        let z = Math.floor((Math.min(s.a.z, s.b.z) - r) / 50);
        z <= Math.floor((Math.max(s.a.z, s.b.z) + r) / 50);
        z++
      )
        keys.push(`${x},${z}`);
    return keys;
  };
  for (const edge of physical)
    for (let i = 1; i < edge.points.length; i++) {
      const s = {
        edge,
        a: edge.points[i - 1],
        b: edge.points[i],
        id: segments.length,
      };
      segments.push(s);
      for (const key of keys(s)) {
        const list = cells.get(key) || [];
        list.push(s);
        cells.set(key, list);
      }
    }
  const seen = new Set<string>();
  for (const s of segments) {
    if (!s.edge.bridge && !s.edge.tunnel) continue;
    for (const key of keys(s))
      for (const f of cells.get(key) || []) {
        const pair = [s.id, f.id].sort((a, b) => a - b).join(':');
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (
          s.edge.way === f.edge.way ||
          [s.edge.from, s.edge.to].some(
            (id) => id === f.edge.from || id === f.edge.to,
          )
        )
          continue;
        if (
          s.edge.layer === f.edge.layer &&
          s.edge.bridge === f.edge.bridge &&
          s.edge.tunnel === f.edge.tunnel
        )
          continue;
        const upper =
          s.edge.layer > f.edge.layer
            ? s
            : s.edge.layer < f.edge.layer
              ? f
              : s.edge.bridge
                ? s
                : f;
        const lower = upper === s ? f : s;
        const length = distance2(upper.a, upper.b),
          nx = (upper.b.z - upper.a.z) / length,
          nz = -(upper.b.x - upper.a.x) / length;
        const width =
          upper.edge.width / 2 +
          (upper.edge.bridge ? SIDEWALK_WIDTH + CURB_WIDTH : 0);
        let polygon = [
          { ...upper.a, x: upper.a.x + nx * width, z: upper.a.z + nz * width },
          { ...upper.b, x: upper.b.x + nx * width, z: upper.b.z + nz * width },
          { ...upper.b, x: upper.b.x - nx * width, z: upper.b.z - nz * width },
          { ...upper.a, x: upper.a.x - nx * width, z: upper.a.z - nz * width },
        ];
        const l = distance2(lower.a, lower.b),
          dx = (lower.b.x - lower.a.x) / l,
          dz = (lower.b.z - lower.a.z) / l;
        const along = (p: Point) =>
          (p.x - lower.a.x) * dx + (p.z - lower.a.z) * dz;
        const across = (p: Point) =>
          (p.x - lower.a.x) * dz - (p.z - lower.a.z) * dx;
        for (const signed of [
          (p: Point) => along(p),
          (p: Point) => l - along(p),
          (p: Point) => lower.edge.width / 2 - across(p),
          (p: Point) => lower.edge.width / 2 + across(p),
        ]) {
          const output: Point[] = [];
          for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i],
              b = polygon[(i + 1) % polygon.length],
              da = signed(a),
              db = signed(b);
            if (da >= 0) output.push(a);
            if (da >= 0 !== db >= 0)
              output.push(mixPoint(a, b, da / (da - db)));
          }
          polygon = output;
        }
        for (const p of polygon) {
          const t = projectOnSegment(p, upper.a, upper.b).t,
            u = projectOnSegment(p, lower.a, lower.b).t;
          // Короткие OSM-соединители у съезда не создают второй уровень.
          // Исключение локально у торцов: настоящее пересечение в середине
          // моста по-прежнему требует просвета, даже при связанном графе.
          if (
            junctions(upper.edge, lower.edge).some(
              (j) =>
                distance2(mixPoint(upper.a, upper.b, t), j.a) <= j.radius &&
                distance2(mixPoint(lower.a, lower.b, u), j.b) <= j.radius,
            )
          )
            continue;
          result.push({
            upper,
            lower,
            t,
            u,
          });
        }
      }
  }
  return result;
}
export function crossingClearance(c: RoadCrossing) {
  return (
    mixPoint(c.upper.a, c.upper.b, c.t).y -
    mixPoint(c.lower.a, c.lower.b, c.u).y -
    (c.upper.edge.bridge ? BRIDGE_DECK_THICKNESS : 0)
  );
}

// Поднимаем связанную конструкцию целиком; поправка плавно затухает на подходах
// по расстоянию вдоль дорожного графа, а не по близости соседней набережной.
export function fitBridgeClearance(edges: Edge[]) {
  fitStructureHeight(edges);
}
export function fitTunnelDepth(edges: Edge[], elevation: ElevationGrid) {
  fitStructureHeight(edges, elevation);
}
function fitStructureHeight(edges: Edge[], tunnelTerrain?: ElevationGrid) {
  const physical = physicalEdges(edges),
    peers = tunnelTerrain
      ? new Map<number, { id: number }[]>()
      : bridgePeers(physical),
    links = new Map<number, Edge[]>();
  for (const e of physical)
    for (const id of [e.from, e.to]) {
      const list = links.get(id) || [];
      list.push(e);
      links.set(id, list);
    }
  const visited = new Set<Edge>(),
    groups: Edge[][] = [];
  for (const seed of physical
    .filter((e) => (tunnelTerrain ? e.tunnel : e.bridge))
    .sort(
      (a, b) =>
        (tunnelTerrain ? b.layer - a.layer : a.layer - b.layer) ||
        a.way - b.way,
    )) {
    if (visited.has(seed)) continue;
    const group: Edge[] = [],
      queue = [seed];
    while (queue.length) {
      const e = queue.pop()!;
      if (visited.has(e)) continue;
      visited.add(e);
      group.push(e);
      for (const id of [e.from, e.to])
        for (const next of [
          id,
          ...(peers.get(id) || []).map((p) => p.id),
        ].flatMap((n) => links.get(n) || []))
          if (
            (tunnelTerrain ? next.tunnel : next.bridge) &&
            next.layer === seed.layer &&
            !visited.has(next)
          )
            queue.push(next);
    }
    groups.push(group);
  }
  const crossings = roadCrossings(physical);
  for (const group of groups) {
    const members = new Set(group),
      contacts = crossings.filter((c) =>
        members.has(tunnelTerrain ? c.lower.edge : c.upper.edge),
      );
    // 5,7 м внутренней высоты плюс перекрытие и грунт над крышей.
    const rise = tunnelTerrain
      ? Math.min(
          0,
          ...group.flatMap((e) =>
            e.points.map(
              (p) => sampleRoadElevation(tunnelTerrain, p.x, p.z) - 6.5 - p.y,
            ),
          ),
          ...contacts.map((c) => crossingClearance(c) - 6.5),
        )
      : Math.max(
          0,
          ...contacts.map(
            (c) => MIN_ROAD_CLEARANCE + 0.03 - crossingClearance(c),
          ),
        );
    if (Math.abs(rise) < 1e-6) continue;
    const ramp = Math.max(100, (Math.abs(rise) * 1.875) / 0.06),
      distances = new Map<number, number>();
    const queue: { id: number; d: number }[] = [];
    for (const e of group)
      for (const id of [e.from, e.to])
        if (!distances.has(id)) {
          distances.set(id, 0);
          queue.push({ id, d: 0 });
        }
    while (queue.length) {
      queue.sort((a, b) => b.d - a.d);
      const { id, d } = queue.pop()!;
      if (d !== distances.get(id)) continue;
      for (const e of links.get(id) || []) {
        // Реальное примыкание к другому сооружению также должно оставаться
        // непрерывным; геометрически пересекающая дорога не имеет общего узла.
        const next = e.from === id ? e.to : e.from,
          nd =
            d +
            e.points
              .slice(1)
              .reduce((sum, p, i) => sum + distance2(p, e.points[i]), 0);
        if (nd < ramp && nd < (distances.get(next) ?? Infinity)) {
          distances.set(next, nd);
          queue.push({ id: next, d: nd });
        }
      }
    }
    const changed = new Map<string, number[]>();
    for (const e of physical) {
      if (!members.has(e) && !distances.has(e.from) && !distances.has(e.to))
        continue;
      const total = e.points
        .slice(1)
        .reduce((sum, p, i) => sum + distance2(p, e.points[i]), 0);
      let station = 0;
      const heights = e.points.map((p, i) => {
        if (i) station += distance2(p, e.points[i - 1]);
        const d = members.has(e)
          ? 0
          : Math.min(
              (distances.get(e.from) ?? Infinity) + station,
              (distances.get(e.to) ?? Infinity) + total - station,
            );
        return p.y + rise * (1 - smoother(d / ramp));
      });
      changed.set(
        physicalKey(e),
        e.from < e.to ? heights : [...heights].reverse(),
      );
    }
    // Обновляем в том числе обратные направления и ссылки сегментов проверки.
    for (const e of edges) {
      const heights = changed.get(physicalKey(e));
      if (heights) {
        if (
          tunnelTerrain &&
          !e.tunnel &&
          e.points.some(
            (p, i) =>
              Math.abs(
                p.y - heights[e.from < e.to ? i : heights.length - 1 - i],
              ) > 1e-6,
          )
        )
          e.tunnelApproach = true;
        e.points.forEach(
          (p, i) => (p.y = heights[e.from < e.to ? i : heights.length - 1 - i]),
        );
      }
    }
  }
}

export function validateClearance(edges: Edge[]): string[] {
  const closed = new Set<number>();
  const issues = new Map<number, NonNullable<Edge['clearanceIssue']>>();
  for (const c of roadCrossings(edges))
    if (crossingClearance(c) < MIN_ROAD_CLEARANCE - 1e-6) {
      const upper = c.upper.edge.bridge || c.upper.edge.tunnel;
      const edge = upper ? c.upper.edge : c.lower.edge;
      if (!edge.bridge && !edge.tunnel) continue;
      closed.add(edge.way);
      const available = crossingClearance(c);
      if (available < (issues.get(edge.way)?.available ?? Infinity))
        issues.set(edge.way, {
          otherWay: (upper ? c.lower : c.upper).edge.way,
          available,
          required: MIN_ROAD_CLEARANCE,
          point: mixPoint(c.upper.a, c.upper.b, c.t),
        });
    }
  for (const edge of edges)
    if (closed.has(edge.way)) {
      edge.blocked = true;
      edge.blockedReasons = [
        ...new Set([...(edge.blockedReasons || []), 'clearance' as const]),
      ];
      edge.clearanceIssue = issues.get(edge.way);
    }
  return [...closed]
    .sort((a, b) => a - b)
    .map((id) => `Дорога ${id} закрыта: недостаточный просвет между уровнями.`);
}
