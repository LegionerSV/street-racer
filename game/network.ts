import type { Area, Building, Edge, OSMElement, Point, RegionData, Restriction, RoadNode, Route, World } from './types';
import { clamp, distance2, pathLengths, polygonContains, resample, sampleElevation, seeded, smooth, smoothElevation, toLocal, projectOnSegment } from './geo';
import { validateClearance } from './clearance';
import { roadLayout, directedLanes } from './lanes';

const adjacencyCache = new WeakMap<World, Map<number, Edge[]>>();
export function outgoing(world: World, id: number): Edge[] {
  let map = adjacencyCache.get(world);
  if (!map) { map = new Map(); for (const edge of world.edges) if (!edge.blocked) { const list = map.get(edge.from) || []; list.push(edge); map.set(edge.from, list); } adjacencyCache.set(world, map); }
  return map.get(id) || [];
}
const historyPrefixes = new WeakMap<World, Set<string>>();
export function advanceTurnHistory(world: World, history: number[], way: number): number[] {
  let prefixes = historyPrefixes.get(world);
  if (!prefixes) {
    prefixes = new Set();
    for (const r of world.restrictions) if (r.viaWays) { const chain = [r.fromWay, ...r.viaWays]; for (let i = 1; i <= chain.length; i++) prefixes.add(chain.slice(0, i).join(',')); }
    historyPrefixes.set(world, prefixes);
  }
  const next = history.at(-1) === way ? history : [...history, way];
  for (let i = 0; i < next.length; i++) if (prefixes.has(next.slice(i).join(','))) return next.slice(i);
  return [];
}
export function allowedTurn(world: World, from: Edge, to: Edge, history: number[] = []): boolean {
  if (from.to !== to.from || to.blocked) return false;
  for (const r of world.restrictions) if (r.viaWays) {
    const chain = [r.fromWay, ...r.viaWays];
    for (let n = 1; n <= chain.length; n++) {
      if (history.length < n || !chain.slice(0, n).every((way, i) => history[history.length - n + i] === way)) continue;
      const expected = chain[n] ?? r.toWay;
      if (r.only && to.way !== from.way && to.way !== expected) return false;
      if (!r.only && n === chain.length && to.way === r.toWay) return false;
    }
  }
  for (const r of world.restrictions) if (r.via === from.to && r.fromWay === from.way) {
    if (r.kind === 'no_u_turn' && r.fromWay === r.toWay) { if (to.to === from.from) return false; continue; }
    if (r.kind === 'only_u_turn') { if (to.to !== from.from) return false; continue; }
    if (r.only && r.toWay !== to.way) return false;
    if (!r.only && r.toWay === to.way) return false;
  }
  return true;
}
const roadTypes = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'road']);

export function buildWorld(region: RegionData): World {
  const sourceNodes = new Map(region.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const roadNodes = new Map<number, RoadNode>();
  const edges: Edge[] = [], warnings: string[] = [];
  const filteredElevation = smoothElevation(region.elevation);
  const originHeight = sampleElevation(filteredElevation, 0, 0);
  // Все объекты используют одну относительную высоту, чтобы избежать потери точности физики.
  const elevation = { ...filteredElevation, values: Float32Array.from(filteredElevation.values, h => h - originHeight) };
  const local = (id: number): Point | null => { const n = sourceNodes.get(id); if (n?.lat === undefined || n.lon === undefined) return null; const p = toLocal(n.lat, n.lon, region.center); p.y = sampleElevation(elevation, p.x, p.z); return p; };
  const tagsNumber = (value: string | undefined, fallback: number) => { const n = parseFloat(value || ''); return Number.isFinite(n) ? n : fallback; };
  for (const way of region.elements) {
    const tags = way.tags || {};
    if (way.type !== 'way' || !way.nodes || !roadTypes.has(tags.highway) || tags.area === 'yes' || tags.access === 'no' || tags.access === 'private' || tags.motor_vehicle === 'no' || tags.motorcar === 'no') continue;
    const bridge = !!tags.bridge && tags.bridge !== 'no', tunnel = !!tags.tunnel && !['no', 'building_passage'].includes(tags.tunnel);
    const layout=roadLayout(tags),oneWay=layout.oneWay===1,reverse=layout.oneWay===-1,lanes=layout.total,width=layout.width;
    const speedTag = tagsNumber(tags.maxspeed, tags.highway === 'living_street' ? 20 : tags.highway === 'motorway' ? 90 : tags.highway === 'service' ? 25 : 50);
    const speed = clamp(speedTag * (tags.maxspeed?.includes('mph') ? 1.609344 : 1) / 3.6, 5, 36);
    const full = way.nodes.map(local);
    if (full.some(p => !p)) { warnings.push(`Дорога ${way.id}: неполные координаты.`); continue; }
    const source = full as Point[], lengths = pathLengths(source), total = lengths.at(-1) || 1;
    const first = source[0], last = source[source.length - 1];
    const layer = tagsNumber(tags.layer, bridge ? 1 : tunnel ? -1 : 0);
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = source[i], b = source[i + 1];
      if (distance2(a, b) < .5) continue;
      if ((Math.abs(a.x) > 2600 || Math.abs(a.z) > 2600) && (Math.abs(b.x) > 2600 || Math.abs(b.z) > 2600)) continue;
      // Дороги, пересекающие границу, закрываются, а не ведут за пределы подготовленного мира.
      const outside = [a, b].some(p => Math.abs(p.x) > 2480 || Math.abs(p.z) > 2480);
      let points = resample([a, b], 10);
      points = points.map((p, j) => {
        const d = lengths[i] + distance2(a, b) * j / (points.length - 1), t = d / total;
        let h = sampleElevation(elevation, p.x, p.z);
        if (bridge || tunnel) {
          const transition = smooth(Math.min(d, total - d) / Math.min(90, total * .4));
          const base = first.y + (last.y - first.y) * t;
          h = bridge ? base + Math.max(6.5, Math.abs(layer) * 6.5) * transition : base - Math.max(8, Math.abs(layer) * 7) * transition;
        }
        return { ...p, y: h + .12 };
      });
      const grades = points.slice(1).map((p, j) => Math.abs(p.y - points[j].y) / (distance2(p, points[j]) || 1));
      const blocked = outside || grades.some(g => g > .38);
      for (const [id, p] of [[way.nodes[i], points[0]], [way.nodes[i + 1], points.at(-1)!]] as [number, Point][]) {
        if (!roadNodes.has(id)) roadNodes.set(id, { ...p, id, signal: sourceNodes.get(id)?.tags?.highway === 'traffic_signals' });
      }
      const base = { way: way.id, length: pathLengths(points).at(-1)!, width, lanes, speed, name: tags.name || 'Безымянная улица', category: tags.highway, oneWay: oneWay || reverse, passage: tags.tunnel === 'building_passage', bridge, tunnel, layer, blocked };
      if (!reverse && layout.forward > 0) edges.push({ ...base, id: edges.length, from: way.nodes[i], to: way.nodes[i + 1], laneProfile: directedLanes(layout, region.drivingSide, 1), markingStart: lengths[i], points });
      if ((!oneWay || reverse) && layout.backward > 0) edges.push({ ...base, id: edges.length, from: way.nodes[i + 1], to: way.nodes[i], laneProfile: directedLanes(layout, region.drivingSide, -1), markingStart: lengths[i + 1], points: [...points].reverse() });
    }
  }
  const restrictions: Restriction[] = [];
  for (const r of region.elements) if (r.type === 'relation' && r.tags?.type === 'restriction' && r.members) {
    const from = r.members.find(m => m.role === 'from'), to = r.members.find(m => m.role === 'to'), via = r.members.find(m => m.role === 'via' && m.type === 'node');
    if (from && to && via) restrictions.push({ fromWay: from.ref, toWay: to.ref, via: via.ref, only: (r.tags.restriction || '').startsWith('only_'), kind: r.tags.restriction });
    const viaWays = r.members.filter(m => m.role === 'via' && m.type === 'way').map(m => m.ref);
    if (from && to && viaWays.length) restrictions.push({ fromWay: from.ref, toWay: to.ref, via: -1, viaWays, only: (r.tags.restriction || '').startsWith('only_'), kind: r.tags.restriction });
  }
  const buildings: Building[] = [], areas: Area[] = [], trees: Point[] = [];
  const ways = new Map(region.elements.filter(e => e.type === 'way').map(e => [e.id, e]));
  const relationWays = new Set<number>();
  function rings(ids: number[]): Point[][] {
    const chains = ids.map(id => [...(ways.get(id)?.nodes || [])]).filter(n => n.length > 1), result: Point[][] = [];
    while (chains.length) {
      const chain = chains.pop()!;
      while (chain[0] !== chain.at(-1)) {
        const i = chains.findIndex(c => c[0] === chain.at(-1) || c.at(-1) === chain.at(-1));
        if (i < 0) break;
        const next = chains.splice(i, 1)[0]; if (next.at(-1) === chain.at(-1)) next.reverse(); chain.push(...next.slice(1));
      }
      const points = chain.map(local); if (chain[0] === chain.at(-1) && points.every(Boolean)) result.push((points as Point[]).slice(0, -1));
    }
    return result;
  }
  function addObject(e: OSMElement, footprint: Point[], holes: Point[][] = []) {
    const t = e.tags || {};
    if (footprint.length < 3 || footprint.every(p => Math.abs(p.x) > 2800 || Math.abs(p.z) > 2800)) return;
    if (t.building || t['building:part']) {
      const fallback = ['house', 'detached', 'garage', 'garages'].includes(t.building) ? 6 : 10 + Math.floor(seeded(e.id) * 6) * 3;
      const height = clamp(tagsNumber(t.height, tagsNumber(t['building:levels'], fallback / 3) * 3), 2.5, 260);
      buildings.push({ id: e.id, footprint, holes, height, minHeight: clamp(tagsNumber(t.min_height, tagsNumber(t['building:min_level'], 0) * 3), 0, height - 1), part: !!t['building:part'], colour: seeded(e.id), roof: t['roof:shape'] || 'flat' });
    } else if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') areas.push({ id: e.id, points: footprint, holes, kind: 'water' });
    else if (['grass', 'forest', 'recreation_ground', 'meadow'].includes(t.landuse) || t.leisure === 'park' || t.natural === 'wood') areas.push({ id: e.id, points: footprint, holes, kind: 'park' });
  }
  for (const e of region.elements) if (e.type === 'relation' && e.tags?.type === 'multipolygon') {
    const outerIds = (e.members || []).filter(m => m.type === 'way' && m.role !== 'inner').map(m => m.ref), innerIds = (e.members || []).filter(m => m.type === 'way' && m.role === 'inner').map(m => m.ref);
    for (const outline of rings(outerIds)) addObject(e, outline, rings(innerIds).filter(hole => polygonContains(hole[0], outline)));
    [...outerIds, ...innerIds].forEach(id => relationWays.add(id));
  }
  for (const e of region.elements) {
    if (e.type === 'way' && e.nodes && !relationWays.has(e.id) && e.nodes[0] === e.nodes.at(-1)) { const footprint = e.nodes.slice(0, -1).map(local); if (footprint.every(Boolean)) addObject(e, footprint as Point[]); }
    if (e.type === 'node' && e.tags?.natural === 'tree') { const p = local(e.id); if (p) trees.push(p); }
  }
  // Части здания заменяют общую оболочку: совпадающие фасады не рисуются дважды.
  const parts = buildings.filter(b => b.part);
  const polygonArea = (ring:Point[]) => Math.abs(ring.reduce((sum,p,i)=>sum+p.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*p.z,0)/2);
  const filteredBuildings = buildings.filter(b => {
    if(b.part)return true;
    const contained=parts.filter(part=>part.id!==b.id&&part.footprint.every(p=>polygonContains(p,b.footprint)||b.footprint.some((a,i)=>projectOnSegment(p,a,b.footprint[(i+1)%b.footprint.length]).distance<.2)));
    return contained.reduce((sum,part)=>sum+polygonArea(part.footprint),0)<polygonArea(b.footprint)*.8;
  });
  // Отбрасываем только повреждённые контуры, которые физически перегораживают наземную дорогу.
  const roadCells = new Map<string, Edge[]>();
  for (const e of edges) if (!e.bridge && !e.tunnel) {
    for (const p of e.points) { const key = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`; const list = roadCells.get(key) || []; if (list.at(-1) !== e) list.push(e); roadCells.set(key, list); }
  }
  const validBuildings = filteredBuildings.filter(b => {
    const minX = Math.min(...b.footprint.map(p => p.x)), maxX = Math.max(...b.footprint.map(p => p.x)), minZ = Math.min(...b.footprint.map(p => p.z)), maxZ = Math.max(...b.footprint.map(p => p.z));
    const candidates = new Set<Edge>();
    for (let x = Math.floor(minX / 100) - 1; x <= Math.floor(maxX / 100) + 1; x++) for (let z = Math.floor(minZ / 100) - 1; z <= Math.floor(maxZ / 100) + 1; z++) for (const e of roadCells.get(`${x},${z}`) || []) candidates.add(e);
    for (const e of candidates) for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], c = e.points[i], mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
      const floor = Math.min(...b.footprint.map(p => p.y)) + (b.minHeight || 0);
      if (floor > mid.y + 4.5) continue;
      const inside = polygonContains(mid, b.footprint) && !(b.holes || []).some(h => polygonContains(mid, h));
      const crosses = b.footprint.some((p,j) => {
        const q=b.footprint[(j+1)%b.footprint.length],rx=c.x-a.x,rz=c.z-a.z,sx=q.x-p.x,sz=q.z-p.z,cross=rx*sz-rz*sx;
        const t=Math.abs(cross)>.00001?((p.x-a.x)*sz-(p.z-a.z)*sx)/cross:-1,u=Math.abs(cross)>.00001?((p.x-a.x)*rz-(p.z-a.z)*rx)/cross:-1;
        return t>=0&&t<=1&&u>=0&&u<=1 || projectOnSegment(p,a,c).distance<e.width/2-.25;
      }) && !(b.holes || []).some(h => polygonContains(mid, h));
      if (inside || crosses) { if (e.passage) { b.minHeight = Math.max(b.minHeight || 0, 5.5); b.height = Math.max(b.height,b.minHeight+2.5); } else return false; }
    }
    return true;
  });
  const omitted = filteredBuildings.length - validBuildings.length;
  if (omitted) warnings.push(`${omitted} конфликтующих контуров зданий пропущено для свободного проезда.`);
  buildings.splice(0, buildings.length, ...validBuildings);
  const nodes = [...roadNodes.values()];
  const neighbours = new Map<number, Set<number>>(), nodeWays = new Map<number, Set<number>>();
  for (const e of edges) for (const id of [e.from, e.to]) { const ways = nodeWays.get(id) || new Set<number>(); ways.add(e.way); nodeWays.set(id, ways); }
  for (const edge of edges) for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) { const list = neighbours.get(a) || new Set<number>(); list.add(b); neighbours.set(a, list); }
  for (const edge of edges) {
    const distances = pathLengths(edge.points), total = distances.at(-1)!;
    const start = roadNodes.get(edge.from)!, end = roadNodes.get(edge.to)!;
    const junction = (id: number) => (neighbours.get(id)?.size || 0) > 2 || (nodeWays.get(id)?.size || 0) > 1;
    const flattenStart = junction(edge.from), flattenEnd = junction(edge.to);
    edge.points = edge.points.map((p, i) => { let y = p.y; if (flattenStart && distances[i] < 16) y = start.y + (y - start.y) * smooth(distances[i] / 16); if (flattenEnd && total - distances[i] < 16) y = end.y + (y - end.y) * smooth((total - distances[i]) / 16); return { ...p, y }; });
    edge.length = pathLengths(edge.points).at(-1)!;
    if (edge.points.slice(1).some((p, i) => Math.abs(p.y - edge.points[i].y) / (distance2(p, edge.points[i]) || 1) > .38)) edge.blocked = true;
  }
  warnings.push(...validateClearance(edges));
  const usable = edges.filter(e => !e.blocked);
  const candidates = [...usable].sort((a, b) => {
    const score = (e: Edge) => Math.hypot(e.points[0].x, e.points[0].z) + (e.bridge || e.tunnel ? 1500 : 0) + (e.width < 6 ? 500 : 0) + (e.category === 'service' ? 4000 : e.category === 'living_street' ? 2000 : e.category === 'residential' ? 300 : 0) + (e.length < 45 ? 200 : 0);
    return score(a) - score(b);
  });
  const world: World = { center: region.center, nodes, edges, restrictions, buildings, areas, trees, elevation, drivingSide: region.drivingSide, warnings: [...new Set(warnings)].slice(0, 10), spawnEdge: candidates[0]?.id ?? -1, routes: [] };
  // Выбираем старт в связном компоненте, из которого действительно можно ехать.
  for (const candidate of candidates.slice(0, 100)) {
    const seen = new Set<number>(), stack = [candidate.from]; let length = 0;
    while (stack.length && seen.size < 1500) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); for (const e of outgoing(world, id)) { length += e.length; if (!seen.has(e.to)) stack.push(e.to); } }
    if (length > 800) { world.spawnEdge = candidate.id; break; }
  }
  if (usable.reduce((sum, e) => sum + e.length, 0) < 500) world.warnings.push('Недостаточно связанных дорог для заезда. Выберите другой участок.');
  world.routes = createRoutes(world);
  // Изолированный двор не должен становиться стартом, если рядом есть полноценная сеть.
  if (!world.routes.some(r => r.kind === 'sprint') || !world.routes.some(r => r.kind === 'circuit')) {
    let best = world.routes;
    let bestSpawn = world.spawnEdge;
    for (const candidate of candidates.slice(0, 80)) {
      world.spawnEdge = candidate.id;
      const routes = createRoutes(world);
      if (routes.length > best.length) { best = routes; bestSpawn = candidate.id; }
      if (best.length === 2) break;
    }
    world.spawnEdge = bestSpawn; world.routes = best;
  }
  return world;
}

function shortest(world: World, first: Edge, target: number, forbidden = new Set<number>()): number[] | null {
  // Дейкстра по направленным рёбрам: состояние сохраняет въезд для запретов поворота.
  const initialHistory = advanceTurnHistory(world, [], first.way);
  const states = [{ edge: first.id, history: initialHistory }], stateIds = new Map<string, number>([[`${first.id}:${initialHistory.join(',')}`, 0]]);
  const heap: [number, number][] = [], costs = new Map<number, number>([[0, 0]]), prev = new Map<number, number>();
  const push = (item: [number, number]) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
  push([0, 0]);
  while (heap.length) {
    const [cost, id] = pop(), state = states[id], edge = world.edges[state.edge]; if (cost !== costs.get(id)) continue;
    if (edge.to === target && id !== 0 && (target !== first.from || allowedTurn(world, edge, first, state.history))) { const route = [edge.id]; let current = id; while (current !== 0) { current = prev.get(current)!; route.push(states[current].edge); } return route.reverse(); }
    for (const next of outgoing(world, edge.to)) {
      if (forbidden.has(next.id) || next.to === edge.from || !allowedTurn(world, edge, next, state.history)) continue;
      const history = advanceTurnHistory(world, state.history, next.way), key = `${next.id}:${history.join(',')}`;
      let nextId = stateIds.get(key); if (nextId === undefined) { nextId = states.length; states.push({ edge: next.id, history }); stateIds.set(key, nextId); }
      const nc = cost + next.length; if (nc >= (costs.get(nextId) ?? Infinity)) continue;
      costs.set(nextId, nc); prev.set(nextId, id); push([nc, nextId]);
    }
  }
  return null;
}
export function createRoutes(world: World): Route[] {
  if (world.spawnEdge < 0 || !world.edges.length) return [];
  const first = world.edges[world.spawnEdge], routes: Route[] = [];
  function add(kind: 'sprint' | 'circuit', ids: number[]) {
    if (kind === 'circuit') {
      let history = advanceTurnHistory(world, [], world.edges[ids[0]].way);
      for (let i = 1; i < ids.length * 2; i++) { const from = world.edges[ids[(i - 1) % ids.length]], to = world.edges[ids[i % ids.length]]; if (!allowedTurn(world, from, to, history)) return; history = advanceTurnHistory(world, history, to.way); }
    }
    const raw: Point[] = [];
    for (const id of ids) raw.push(...world.edges[id].points.slice(raw.length ? 1 : 0));
    // Контрольные точки по 70 м, с обязательными углами маршрута.
    const points = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) if (distance2(points.at(-1)!, raw[i]) > 65 || (i % 4 === 0 && Math.abs((raw[i].x - raw[i - 1].x) * (raw[i + 1].z - raw[i].z) - (raw[i].z - raw[i - 1].z) * (raw[i + 1].x - raw[i].x)) > 20)) points.push(raw[i]);
    points.push(raw.at(-1)!);
    const cumulative = pathLengths(points), length = cumulative.at(-1)!;
    if (length < 400) return;
    routes.push({ id: `${kind}-${first.way}`, title: kind === 'circuit' ? 'Ночной круг' : 'Через район', kind, edges: ids, points, cumulative, length, laps: kind === 'circuit' ? 3 : 1 });
  }
  const ring = shortest(world, first, first.from);
  if (ring) add('circuit', ring);
  const reachable = new Set<number>(), queue = [first.to];
  while (queue.length) { const id = queue.pop()!; if (reachable.has(id)) continue; reachable.add(id); for (const edge of outgoing(world, id)) if (!reachable.has(edge.to)) queue.push(edge.to); }
  const distant = world.nodes.filter(n => reachable.has(n.id) && outgoing(world, n.id).length).sort((a, b) => distance2(b, first.points[0]) - distance2(a, first.points[0]));
  for (const target of distant.slice(0, 12)) { const path = shortest(world, first, target.id); if (path) { add('sprint', path); break; } }
  return routes;
}
