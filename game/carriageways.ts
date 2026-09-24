import {
  distance2,
  mixPoint,
  pathLengths,
  sampleRoadElevation,
  smoother,
} from './geo';
import { boundsOf, SpatialGrid } from './geometry';
import { MinHeap } from './min-heap';
import type { Edge, ElevationGrid, Point, RoadNode } from './types';

export type CarriagewayJoin = {
  side: number;
  nearA: Point;
  nearB: Point;
  farA: Point;
  farB: Point;
  other: Edge;
  owner: boolean;
};
type Segment = { a: Point; b: Point; edge: Edge };

export function alignGroundIntersections(
  edges: Edge[],
  preserved: ReadonlySet<string> = new Set(),
) {
  type Part = Segment & { start: number; length: number };
  const spatial = new SpatialGrid<Part>(32),
    parts: Part[] = [],
    stations = new Map<Edge, number[]>(),
    seen = new Set<string>();
  for (const edge of edges) {
    if (edge.bridge || edge.tunnel || edge.tunnelApproach || edge.passage)
      continue;
    const physical = `${edge.way}/${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`;
    if (seen.has(physical)) continue;
    seen.add(physical);
    const lengths = [0];
    for (let i = 1; i < edge.points.length; i++)
      lengths.push(
        lengths[i - 1] + distance2(edge.points[i - 1], edge.points[i]),
      );
    stations.set(edge, lengths);
    for (let i = 1; i < edge.points.length; i++) {
      const length = distance2(edge.points[i - 1], edge.points[i]);
      if (!length) continue;
      parts.push({
        a: edge.points[i - 1],
        b: edge.points[i],
        edge,
        start: lengths[i - 1],
        length,
      });
    }
  }
  const anchors = new Map<Edge, { station: number; delta: number }[]>(),
    pairs = new Set<string>();
  const add = (edge: Edge, station: number, delta: number) => {
    const list = anchors.get(edge) ?? [];
    list.push({ station, delta });
    anchors.set(edge, list);
  };
  for (const part of parts) {
    for (const other of spatial.query(boundsOf([part.a, part.b], 0.2))) {
      if (
        other.edge.way === part.edge.way ||
        other.edge.layer !== part.edge.layer
      )
        continue;
      const pair = [
        part.edge.stableId,
        other.edge.stableId,
        String(part.start),
        String(other.start),
      ]
        .sort()
        .join('|');
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      const dx = part.b.x - part.a.x,
        dz = part.b.z - part.a.z,
        ex = other.b.x - other.a.x,
        ez = other.b.z - other.a.z,
        den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-6) continue;
      const t =
          ((other.a.x - part.a.x) * ez - (other.a.z - part.a.z) * ex) / den,
        u = ((other.a.x - part.a.x) * dz - (other.a.z - part.a.z) * dx) / den;
      if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) continue;
      const y = part.a.y + (part.b.y - part.a.y) * t,
        otherY = other.a.y + (other.b.y - other.a.y) * u,
        difference = otherY - y;
      if (Math.abs(difference) <= 0.15) continue;
      const partFixed = preserved.has(part.edge.stableId),
        otherFixed = preserved.has(other.edge.stableId);
      if (partFixed && otherFixed) continue;
      if (partFixed)
        add(other.edge, other.start + other.length * u, -difference);
      else if (otherFixed)
        add(part.edge, part.start + part.length * t, difference);
      else {
        add(part.edge, part.start + part.length * t, difference / 2);
        add(other.edge, other.start + other.length * u, -difference / 2);
      }
    }
    spatial.add(part, boundsOf([part.a, part.b], 0.2));
  }
  for (const [edge, values] of anchors) {
    const lengths = stations.get(edge)!;
    edge.points = edge.points.map((point, index) => {
      let sum = 0,
        weight = 0;
      for (const anchor of values) {
        const w = smoother(
          1 - Math.min(1, Math.abs(lengths[index] - anchor.station) / 22),
        );
        sum += anchor.delta * w;
        weight += w;
      }
      return weight ? { ...point, y: point.y + sum / weight } : point;
    });
    edge.length = pathLengths(edge.points).at(-1)!;
  }
  return anchors.size > 0;
}
// Для каждого источника расстояния независимы: разные радиусы перехода
// не позволяют отбрасывать источник, проигравший лишь в промежуточном узле.
export function carriagewayTransitions(
  edges: Pick<Edge, 'from' | 'to' | 'points'>[],
  anchors: ReadonlyMap<number, number>,
) {
  const links = new Map<number, Map<number, number>>();
  for (const edge of edges) {
    const length = edge.points
      .slice(1)
      .reduce((sum, p, i) => sum + distance2(p, edge.points[i]), 0);
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      const list = links.get(from) ?? new Map<number, number>();
      list.set(to, Math.min(length, list.get(to) ?? Infinity));
      links.set(from, list);
    }
  }
  type Reach = {
    id: number;
    source: number;
    distance: number;
    ramp: number;
    value: number;
  };
  const queue = new MinHeap<Reach>(
    (a, b) => a.distance - b.distance || a.source - b.source,
  );
  const reached = new Map<number, Map<number, Reach>>();
  for (const [id, value] of anchors) {
    if (Math.abs(value) < 1e-8) continue;
    const entry = {
      id,
      source: id,
      distance: 0,
      ramp: Math.max(60, (Math.abs(value) * 1.875) / 0.03),
      value,
    };
    reached.set(id, new Map([[id, entry]]));
    queue.push(entry);
  }
  while (queue.size) {
    const entry = queue.pop()!,
      source = reached.get(entry.source)!;
    if (source.get(entry.id) !== entry) continue;
    for (const [id, length] of links.get(entry.id) ?? []) {
      if (anchors.has(id)) continue;
      const next = { ...entry, id, distance: entry.distance + length };
      if (
        next.distance >= next.ramp ||
        next.distance >= (source.get(id)?.distance ?? Infinity)
      )
        continue;
      source.set(id, next);
      queue.push(next);
    }
  }
  const contributions = new Map<number, { sum: number; weight: number }>();
  // Смешиваем опоры, чтобы встречные поправки не создавали горб на поперечном
  // проезде. Обратная дистанция даёт линейную интерполяцию между двумя торцами.
  for (const [, source] of [...reached].sort(([a], [b]) => a - b))
    for (const entry of source.values()) {
      if (anchors.has(entry.id)) continue;
      const fade = 1 - smoother(entry.distance / entry.ramp),
        weight = fade / Math.max(0.001, entry.distance);
      const value = contributions.get(entry.id) ?? { sum: 0, weight: 0 };
      value.sum += entry.value * fade * weight;
      value.weight += weight;
      contributions.set(entry.id, value);
    }
  const result = new Map(anchors);
  for (const [id, value] of contributions)
    if (value.weight) result.set(id, value.sum / value.weight);
  return result;
}
const surfaceCarriageway = (edge: Edge) =>
  edge.oneWay &&
  !edge.bridge &&
  !edge.tunnel &&
  !edge.passage &&
  !edge.blocked &&
  edge.name !== 'Безымянная улица' &&
  !edge.category?.endsWith('_link');
const bridgeCarriageway = (edge: Edge) =>
  edge.oneWay &&
  edge.bridge &&
  !edge.tunnel &&
  !edge.blocked &&
  edge.name !== 'Безымянная улица' &&
  !edge.category?.endsWith('_link');
const sameStreet = (edge: Edge, other: Edge) =>
  other.way !== edge.way &&
  surfaceCarriageway(other) &&
  other.layer === edge.layer &&
  other.name === edge.name &&
  other.category === edge.category;
const sameBridge = (edge: Edge, other: Edge) =>
  other.way !== edge.way &&
  bridgeCarriageway(other) &&
  other.layer === edge.layer &&
  other.name === edge.name &&
  other.category === edge.category;

export function alignBridgeCarriageways(
  edges: Edge[],
  nodes: Map<number, RoadNode>,
  elevation: ElevationGrid,
  drivingSide: 'left' | 'right',
  preserved?: ReadonlySet<string>,
) {
  return alignCarriagewayElevations(edges, nodes, elevation, drivingSide, preserved, 'bridge');
}
export function alignBridgeApproaches(
  edges: Edge[],
  nodes: Map<number, RoadNode>,
  elevation: ElevationGrid,
  drivingSide: 'left' | 'right',
  preserved?: ReadonlySet<string>,
) {
  return alignCarriagewayElevations(edges, nodes, elevation, drivingSide, preserved, 'approach');
}

function oppositeProjection(p: Point, s: Segment, candidate: Segment) {
  const { a, b } = s,
    { a: c, b: d } = candidate;
  const length = distance2(a, b),
    len = distance2(c, d);
  if (
    !length ||
    !len ||
    ((d.x - c.x) * (b.x - a.x) + (d.z - c.z) * (b.z - a.z)) / (len * length) >
      -0.985
  )
    return;
  // Пересечение поперечника с соседней осью. Ортогональная проекция на
  // соседний сегмент сдвигалась вдоль дороги и отбрасывала плавные расхождения.
  const t =
    ((p.x - c.x) * (b.x - a.x) + (p.z - c.z) * (b.z - a.z)) /
    ((d.x - c.x) * (b.x - a.x) + (d.z - c.z) * (b.z - a.z));
  const point = mixPoint(c, d, Math.max(0, Math.min(1, t)));
  const q = { point, distance: distance2(p, point) };
  // Торец соседней дороги не продолжается за пределы её геометрии.
  if (
    Math.abs(
      (q.point.x - p.x) * (b.x - a.x) + (q.point.z - p.z) * (b.z - a.z),
    ) /
      length >
    0.25
  )
    return;
  return q;
}

// Высота общей оси применяется к обеим проезжим частям. Проверяем план и теги,
// а не ошибочную разность DEM, иначе именно требующие исправления пары отсеются.
export function alignCarriagewayElevations(
  edges: Edge[],
  nodes: Map<number, RoadNode>,
  elevation: ElevationGrid,
  drivingSide: 'left' | 'right',
  preserved?: ReadonlySet<string>,
  mode: 'ground' | 'bridge' | 'approach' = 'ground',
) {
  const bridgeNodes = new Set(
    edges.filter((edge) => edge.bridge).flatMap((edge) => [edge.from, edge.to]),
  );
  const eligible = mode === 'bridge'
      ? bridgeCarriageway
      : mode === 'approach'
        ? (edge: Edge) =>
            surfaceCarriageway(edge) &&
            !edge.bridge &&
            (bridgeNodes.has(edge.from) || bridgeNodes.has(edge.to))
        : surfaceCarriageway,
    matching = mode === 'bridge' ? sameBridge : sameStreet;
  const spatial = new SpatialGrid<Segment>(32),
    segments = new Map<Edge, Segment[]>();
  for (const edge of edges)
    if (eligible(edge)) {
      const parts = edge.points
        .slice(1)
        .map((b, i) => ({ a: edge.points[i], b, edge }));
      segments.set(edge, parts);
      for (const part of parts)
        spatial.add(part, boundsOf([part.a, part.b], edge.width / 2 + 12));
    }
  const side = drivingSide === 'right' ? -1 : 1;
  const corrections = new Map<Edge, (number | undefined)[]>(),
    nodeCorrections = new Map<number, number[]>();
  for (const [edge, parts] of segments) {
    if (preserved?.has(edge.stableId)) continue;
    const offsets = edge.points.map((p, i) => {
      const s = parts[Math.min(i, parts.length - 1)],
        length = distance2(s.a, s.b);
      let best: { point: Point; distance: number; way: number } | undefined;
      for (const candidate of spatial.query(boundsOf([p], edge.width / 2))) {
        if (!matching(edge, candidate.edge)) continue;
        if (preserved && !preserved.has(candidate.edge.stableId)) continue;
        const q = oppositeProjection(p, s, candidate);
        if (!q) continue;
        const separation =
          (((q.point.x - p.x) * (s.b.z - s.a.z) -
            (q.point.z - p.z) * (s.b.x - s.a.x)) /
            length) *
          side;
        const gap = separation - (edge.width + candidate.edge.width) / 2;
        if (gap < -1.6 || gap > 12) continue;
        if (
          !best ||
          q.distance < best.distance ||
          (q.distance === best.distance && candidate.edge.way < best.way)
        )
          best = { ...q, way: candidate.edge.way };
      }
      if (!best) return;
      if (preserved) return best.point.y - p.y;
      const center = mixPoint(p, best.point, 0.5);
      if (mode !== 'ground') {
        const rise = Math.max(0, best.point.y - p.y);
        return rise < 0.01 ? 0 : rise;
      }
      return sampleRoadElevation(elevation, center.x, center.z) + 0.12 - p.y;
    });
    if (!offsets.some((v) => v !== undefined)) continue;
    // Если соседний проезд заканчивается/расходится внутри way, переход должен
    // продолжиться через торец, а не вернуться к DEM за последние несколько метров.
    for (const end of [0, offsets.length - 1])
      if (offsets[end] === undefined) {
        let at = end,
          distance = 0;
        const step = end === 0 ? 1 : -1;
        while (offsets[at] === undefined) {
          const next = at + step;
          distance += distance2(edge.points[at], edge.points[next]);
          at = next;
        }
        const value = offsets[at]!,
          ramp = Math.max(60, (Math.abs(value) * 1.875) / 0.03);
        offsets[end] = value * (1 - smoother(distance / ramp));
      }
    corrections.set(edge, offsets);
    for (const [id, value] of [
      [edge.from, offsets[0]],
      [edge.to, offsets.at(-1)],
    ] as const)
      if (value !== undefined) {
        const list = nodeCorrections.get(id) ?? [];
        list.push(value);
        nodeCorrections.set(id, list);
      }
  }
  if (!corrections.size) return;
  if (
    ![...corrections.values()].some((values) =>
      values.some((value) => value !== undefined && Math.abs(value) > 1e-6),
    )
  )
    return;
  const shared = new Map(
    [...nodeCorrections].map(([id, values]) => [
      id,
      values.sort((a, b) => a - b).reduce((sum, v) => sum + v, 0) /
        values.length,
    ]),
  );
  // Подгрузка подстраивает только новое полотно; открытая дорога и сооружения
  // остаются неподвижными, включая общие с ними узлы.
  const fixed = (edge: Edge) =>
    (mode === 'approach' &&
      (edge.bridge || edge.tunnel || edge.tunnelApproach)) ||
    (preserved &&
      (preserved.has(edge.stableId) ||
        (mode !== 'bridge' && edge.bridge) ||
        edge.tunnel ||
        edge.tunnelApproach));
  for (const edge of edges)
    if (fixed(edge)) for (const id of [edge.from, edge.to]) shared.set(id, 0);
  const transitions = carriagewayTransitions(edges, shared);
  for (const edge of edges) {
    if (fixed(edge)) continue;
    const offsets =
      corrections.get(edge) ??
      edge.points.map(() => undefined as number | undefined);
    // Нулевой торец за пределами зоны перехода тоже является опорой.
    if (
      transitions.has(edge.from) ||
      transitions.has(edge.to) ||
      corrections.has(edge)
    ) {
      offsets[0] = transitions.get(edge.from) ?? offsets[0] ?? 0;
      offsets[offsets.length - 1] =
        transitions.get(edge.to) ?? offsets.at(-1) ?? 0;
    }
    const anchors = offsets.flatMap((value, i) =>
      value === undefined ? [] : [{ i, value }],
    );
    if (!anchors.length) continue;
    const stations = [0];
    for (let i = 1; i < edge.points.length; i++)
      stations.push(
        stations[i - 1] + distance2(edge.points[i - 1], edge.points[i]),
      );
    let next = 0;
    edge.points = edge.points.map((p, i) => {
      while (next < anchors.length && anchors[next].i < i) next++;
      const left = anchors[next - 1],
        right = anchors[next];
      let correction = offsets[i];
      if (correction === undefined) {
        if (left && right)
          correction =
            left.value +
            (right.value - left.value) *
              ((stations[i] - stations[left.i]) /
                (stations[right.i] - stations[left.i]));
        else {
          const anchor = left ?? right;
          const ramp = Math.max(60, (Math.abs(anchor.value) * 1.875) / 0.03);
          correction =
            anchor.value *
            (1 - smoother(Math.abs(stations[i] - stations[anchor.i]) / ramp));
        }
      }
      return { ...p, y: p.y + correction };
    });
    edge.length = pathLengths(edge.points).at(-1)!;
  }
  for (const [id, correction] of transitions) {
    const node = nodes.get(id);
    if (node) node.y += correction;
  }
  return true;
}
// Соединяем только узкий промежуток между встречными наземными проезжими
// частями одной улицы. Узлы маршрутов и ограничения поворотов сохраняются.
export function carriagewayJoin(
  s: Segment,
  candidates: Segment[],
  drivingSide: 'left' | 'right',
): CarriagewayJoin | undefined {
  const { a, b, edge } = s;
  if (!surfaceCarriageway(edge)) return;
  const length = distance2(a, b),
    nx = (b.z - a.z) / length,
    nz = -(b.x - a.x) / length;
  const side = drivingSide === 'right' ? -1 : 1;
  let best: CarriagewayJoin | undefined,
    nearest = Infinity;
  const byWay = new Map<number, Segment[]>();
  for (const candidate of candidates) {
    const group = byWay.get(candidate.edge.way) ?? [];
    group.push(candidate);
    byWay.set(candidate.edge.way, group);
  }
  for (const group of byWay.values()) {
    const other = group[0].edge;
    if (!sameStreet(edge, other)) continue;
    const project = (p: Point) => {
      let best: { point: Point; distance: number } | undefined;
      for (const part of group) {
        const q = oppositeProjection(p, s, part);
        if (q && (!best || q.distance < best.distance)) best = q;
      }
      return best;
    };
    const pa = project(a),
      pb = project(b);
    if (!pa || !pb) continue;
    const offsets = [
      (pa.point.x - a.x) * nx + (pa.point.z - a.z) * nz,
      (pb.point.x - b.x) * nx + (pb.point.z - b.z) * nz,
    ];
    const gap = offsets.map((d) => d * side - (edge.width + other.width) / 2);
    if (
      gap.some((d) => d < -1.6 || d > 2) ||
      Math.abs(pa.point.y - a.y) > 0.25 ||
      Math.abs(pb.point.y - b.y) > 0.25
    )
      continue;
    const distance = Math.max(...gap);
    if (distance >= nearest) continue;
    nearest = distance;
    const offset = (p: Point, d: number) => ({
      ...p,
      x: p.x + nx * d * side,
      z: p.z + nz * d * side,
    });
    best = {
      side,
      nearA: offset(a, edge.width / 2),
      nearB: offset(b, edge.width / 2),
      farA: offset(pa.point, -other.width / 2),
      farB: offset(pb.point, -other.width / 2),
      other,
      owner: edge.way < other.way,
    };
  }
  return best;
}
