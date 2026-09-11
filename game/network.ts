import type { Area, Building, Edge, OSMElement, Point, RegionData, Restriction, RoadNode, Route, World } from './types';
import { clamp, distance2, pathLengths, polygonContains, resample, sampleElevation, sampleRoadElevation, seeded, smooth, smoothElevation, toLocal, projectOnSegment, offsetElevation } from './geo';
import { structureProfiles } from './elevation';
import { fitBridgeClearance, fitTunnelDepth, validateClearance } from './clearance';
import { roadLayout, directedLanes,roadTypes } from './lanes';
import {buildingCoveredByParts} from './buildings';
import {SpatialGrid,boundsOf,overlaps} from './geometry';
import {coverageBounds,pointHasCoverage,routeHasCoverage} from './stream-coverage';
import { edgeById, edgeIndex, edgeStableId, makeEdgeStableId } from './road-graph';

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

export function buildWorld(region: RegionData): World {
  const coverage=region.loadedTiles?new Set(region.loadedTiles):undefined;
  const objectBounds=coverageBounds(region.loadedTiles,region.center);
  const covered=(p:Point)=>pointHasCoverage(coverage,p,region.center);
  const sourceNodes = new Map(region.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const roadNodes = new Map<number, RoadNode>();
  const edges: Edge[] = [], warnings: string[] = [];
  const filteredElevation = smoothElevation(region.elevation);
  const originHeight = region.heightDatum ?? sampleElevation(filteredElevation, 0, 0);
  // Все объекты используют одну относительную высоту, чтобы избежать потери точности физики.
  const elevation = offsetElevation(filteredElevation, originHeight);
  const local = (id: number): Point | null => { const n = sourceNodes.get(id); if (n?.lat === undefined || n.lon === undefined) return null; const p = toLocal(n.lat, n.lon, region.center); p.y = sampleElevation(elevation, p.x, p.z); return p; };
  const roadLocal = (id: number): Point | null => { const p = local(id); if (p) p.y = sampleRoadElevation(elevation, p.x, p.z); return p; };
  const tagsNumber = (value: string | undefined, fallback: number) => { const n = parseFloat(value || ''); return Number.isFinite(n) ? n : fallback; };
  const sidewalks = (tags: Record<string, string>) => {
    const fallback = tags.highway !== 'service' && tags.highway !== 'track';
    let left = fallback, right = fallback;
    if (['no', 'none', 'separate'].includes(tags.sidewalk)) left = right = false;
    else if (['yes', 'both'].includes(tags.sidewalk)) left = right = true;
    else if (tags.sidewalk === 'left') { left = true; right = false; }
    else if (tags.sidewalk === 'right') { left = false; right = true; }
    if (tags['sidewalk:both']) left = right = !['no', 'none', 'separate'].includes(tags['sidewalk:both']);
    if (tags['sidewalk:left']) left = !['no', 'none', 'separate'].includes(tags['sidewalk:left']);
    if (tags['sidewalk:right']) right = !['no', 'none', 'separate'].includes(tags['sidewalk:right']);
    return { left, right };
  };
  const roadWays = region.elements.filter(way => {
    const tags = way.tags || {};
    return way.type === 'way' && way.nodes && roadTypes.has(tags.highway) && tags.area !== 'yes' && tags.access !== 'no' && tags.access !== 'private' && tags.motor_vehicle !== 'no' && tags.motorcar !== 'no';
  });
  const profiles = structureProfiles(roadWays, roadLocal, elevation);
  for (const way of roadWays) {
    const tags = way.tags || {};
    if (way.type !== 'way' || !way.nodes || !roadTypes.has(tags.highway) || tags.area === 'yes' || tags.access === 'no' || tags.access === 'private' || tags.motor_vehicle === 'no' || tags.motorcar === 'no') continue;
    const bridge = !!tags.bridge && tags.bridge !== 'no', tunnel = !!tags.tunnel && !['no', 'building_passage'].includes(tags.tunnel);
    const layout=roadLayout(tags),oneWay=layout.oneWay===1,reverse=layout.oneWay===-1,lanes=layout.total,width=layout.width;
    const speedTag = tagsNumber(tags.maxspeed, tags.highway === 'living_street' ? 20 : tags.highway === 'motorway' ? 90 : tags.highway === 'service' ? 25 : 50);
    const speed = clamp(speedTag * (tags.maxspeed?.includes('mph') ? 1.609344 : 1) / 3.6, 5, 36);
    const full = way.nodes.map(roadLocal);
    if (full.some(p => !p)) { warnings.push(`Дорога ${way.id}: неполные координаты.`); continue; }
    const source = full as Point[], lengths = [0];
    for (let i = 1; i < source.length; i++) lengths.push(lengths[i - 1] + distance2(source[i - 1], source[i]));
    const layer = tagsNumber(tags.layer, bridge ? 1 : tunnel ? -1 : 0);
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = source[i], b = source[i + 1];
      if (distance2(a, b) < .5) continue;
      if (coverage ? !resample([a,b],100).some(covered) : (Math.abs(a.x) > 2600 || Math.abs(a.z) > 2600) && (Math.abs(b.x) > 2600 || Math.abs(b.z) > 2600)) continue;
      // Дороги, пересекающие границу, закрываются, а не ведут за пределы подготовленного мира.
      const outside = coverage ? !resample([a,b],50).every(covered) : [a, b].some(p => Math.abs(p.x) > 2480 || Math.abs(p.z) > 2480);
      let points = resample([a, b], bridge || tunnel ? 2.5 : 10);
      const profile = profiles.get(`${way.id}:${i}`);
      points = points.map((p, j) => {
        const h = profile ? profile(j / (points.length - 1)) : sampleRoadElevation(elevation, p.x, p.z);
        return { ...p, y: h + .12 };
      });
      const blocked = outside;
      for (const [id, p] of [[way.nodes[i], points[0]], [way.nodes[i + 1], points.at(-1)!]] as [number, Point][]) {
        if (!roadNodes.has(id)) roadNodes.set(id, { ...p, id, signal: sourceNodes.get(id)?.tags?.highway === 'traffic_signals' });
      }
      const rawHeights=points.map(p=>sampleElevation(region.elevation,p.x,p.z));
      const blockedReasons: NonNullable<Edge['blockedReasons']> = outside ? ['coverage'] : [];
      const walk = sidewalks(tags);
      const base = { sourceHeightRange:[Math.min(...rawHeights),Math.max(...rawHeights)] as [number,number], blockedReasons, way: way.id, length: pathLengths(points).at(-1)!, width, lanes, speed, name: tags.name || 'Безымянная улица', category: tags.highway, oneWay: oneWay || reverse, passage: tags.tunnel === 'building_passage', bridge, tunnel, layer, blocked, unloaded: !!coverage&&outside };
      if (!reverse && layout.forward > 0) edges.push({ ...base, id: edges.length, stableId: makeEdgeStableId(way.id, way.nodes[i], way.nodes[i + 1], i), from: way.nodes[i], to: way.nodes[i + 1], sidewalkLeft:walk.left,sidewalkRight:walk.right,laneProfile: directedLanes(layout, region.drivingSide, 1), markingStart: lengths[i], points });
      if ((!oneWay || reverse) && layout.backward > 0) edges.push({ ...base, id: edges.length, stableId: makeEdgeStableId(way.id, way.nodes[i + 1], way.nodes[i], i), from: way.nodes[i + 1], to: way.nodes[i], sidewalkLeft:walk.right,sidewalkRight:walk.left,laneProfile: directedLanes(layout, region.drivingSide, -1), markingStart: lengths[i + 1], points: [...points].reverse() });
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
    if (footprint.length < 3 || (!coverage && footprint.every(p => Math.abs(p.x) > 2800 || Math.abs(p.z) > 2800))) return;
    const footprintBounds=boundsOf(footprint);
    if(objectBounds && !objectBounds.some(b=>overlaps(b,footprintBounds)))return;
    if (t.building || t['building:part']) {
      const fallback = ['house', 'detached', 'garage', 'garages'].includes(t.building) ? 6 : 10 + Math.floor(seeded(e.id) * 6) * 3;
      const height = clamp(tagsNumber(t.height, tagsNumber(t['building:levels'], fallback / 3) * 3), 2.5, 260);
      buildings.push({ id: e.id, osmType:e.type==='relation'?'relation':'way', footprint, holes, height, minHeight: clamp(tagsNumber(t.min_height, tagsNumber(t['building:min_level'], 0) * 3), 0, height - 1), part: !!t['building:part'], colour: seeded(e.id), roof: t['roof:shape'] || 'flat', material:t['building:material'],facadeColour:t['building:colour'],levels:tagsNumber(t['building:levels'],Math.max(1,Math.round(height/3))),kind:t.building,roofHeight:t['roof:height']?Math.max(0,tagsNumber(t['roof:height'],0)):undefined,roofDirection:t['roof:direction']?tagsNumber(t['roof:direction'],0):undefined,roofOrientation:t['roof:orientation'] });
    } else if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') areas.push({ id: e.id, osmType:e.type==='relation'?'relation':'way', points: footprint, holes, kind: 'water', railing:t.waterway === 'riverbank' || t.water === 'river' ? 'river' : undefined });
    else if (['grass', 'forest', 'recreation_ground', 'meadow'].includes(t.landuse) || t.leisure === 'park' || t.natural === 'wood') {
      const name=t['name:ru']||t.name||'',certainPark=t.leisure==='park'&&/(^|\s)парк(\s|$)/iu.test(name)&&!/сквер/iu.test(name);
      areas.push({ id: e.id, osmType:e.type==='relation'?'relation':'way', points: footprint, holes, kind: 'park', railing:certainPark?'park':undefined });
    }
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
  // Части здания заменяют общую оболочку только при полном покрытии у земли.
  // Надземные и перекрывающиеся части не должны удалять оставшиеся этажи/крылья.
  const parts=new SpatialGrid<Building>(250,objectBounds);
  for(const b of buildings)if(b.part&&(b.minHeight||0)<=.3)parts.add(b,boundsOf(b.footprint));
  const filteredBuildings = buildings.filter(b => {
    if(b.part)return true;
    const contained=parts.query(boundsOf(b.footprint)).filter(part=>part.id!==b.id&&part.footprint.every(p=>polygonContains(p,b.footprint)||b.footprint.some((a,i)=>projectOnSegment(p,a,b.footprint[(i+1)%b.footprint.length]).distance<.2)));
    return !buildingCoveredByParts(b,contained);
  });
  // Пересечение дороги вырезается локально при построении геометрии здания.
  // Поднимать или удалять целый дом ради одной арки нельзя.
  buildings.splice(0,buildings.length,...filteredBuildings);
  const nodes = [...roadNodes.values()];
  const neighbours = new Map<number, Set<number>>();
  for (const edge of edges) for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) { const list = neighbours.get(a) || new Set<number>(); list.add(b); neighbours.set(a, list); }
  for (const edge of edges) {
    const distances = pathLengths(edge.points), total = distances.at(-1)!;
    const start = roadNodes.get(edge.from)!, end = roadNodes.get(edge.to)!;
    const junction = (id: number) => (neighbours.get(id)?.size || 0) > 2;
    const flattenStart = junction(edge.from), flattenEnd = junction(edge.to);
    edge.points = edge.points.map((p, i) => { let y = p.y; if (flattenStart && distances[i] < 16) y = start.y + (y - start.y) * smooth(distances[i] / 16); if (flattenEnd && total - distances[i] < 16) y = end.y + (y - end.y) * smooth((total - distances[i]) / 16); return { ...p, y }; });
    edge.length = pathLengths(edge.points).at(-1)!;
  }
  fitTunnelDepth(edges, elevation);
  fitBridgeClearance(edges);
  for(const edge of edges){
    edge.length=pathLengths(edge.points).at(-1)!;
    edge.blockedReasons = (edge.blockedReasons || []).filter(r=>r!=='grade');
    if(edge.points.slice(1).some((p,i)=>Math.abs(p.y-edge.points[i].y)/(distance2(p,edge.points[i])||1)>.38))edge.blockedReasons.push('grade');
    edge.blocked=edge.blockedReasons.length>0;
    for(const [id,p] of [[edge.from,edge.points[0]],[edge.to,edge.points.at(-1)!]] as [number,Point][])Object.assign(roadNodes.get(id)!,p);
  }
  warnings.push(...validateClearance(edges));
  const usable = edges.filter(e => !e.blocked);
  const candidates = [...usable].sort((a, b) => {
    const score = (e: Edge) => Math.hypot(e.points[0].x-(region.focus?.x||0), e.points[0].z-(region.focus?.z||0)) + (e.bridge || e.tunnel ? 1500 : 0) + (e.width < 6 ? 500 : 0) + (e.category === 'service' ? 4000 : e.category === 'living_street' ? 2000 : e.category === 'residential' ? 300 : 0) + (e.length < 45 ? 200 : 0);
    return score(a) - score(b);
  });
  const world: World = { heightDatum:originHeight, center: region.center, nodes, edges, restrictions, buildings, areas, trees, elevation, drivingSide: region.drivingSide, warnings: [...new Set(warnings)].slice(0, 10), spawnEdge: candidates[0]?.stableId ?? null, routes: [], loadedTiles: region.loadedTiles };
  // Выбираем старт в связном компоненте, из которого действительно можно ехать.
  for (const candidate of candidates.slice(0, 100)) {
    const seen = new Set<number>(), stack = [candidate.from]; let length = 0;
    while (stack.length && seen.size < 1500) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); for (const e of outgoing(world, id)) { length += e.length; if (!seen.has(e.to)) stack.push(e.to); } }
    if (length > 800) { world.spawnEdge = edgeStableId(candidate); break; }
  }
  if (usable.reduce((sum, e) => sum + e.length, 0) < 500) world.warnings.push('Недостаточно связанных дорог для заезда. Выберите другой участок.');
  world.routes = createRoutes(world);
  // Изолированный двор не должен становиться стартом, если рядом есть полноценная сеть.
  if (!world.routes.some(r => r.kind === 'sprint') || !world.routes.some(r => r.kind === 'circuit')) {
    let best = world.routes;
    let bestSpawn = world.spawnEdge;
    for (const candidate of candidates.slice(0, 80)) {
      world.spawnEdge = edgeStableId(candidate);
      const routes = createRoutes(world);
      if (routes.length > best.length) { best = routes; bestSpawn = edgeStableId(candidate); }
      if (best.length === 2) break;
    }
    world.spawnEdge = bestSpawn; world.routes = best;
  }
  world.routes = createRaceLocations(world);
  return world;
}

const safeRaceCache = new WeakMap<World, Set<number>>();
const raceRoad = (edge: Edge) => !['service', 'living_street', 'track'].includes(edge.category || '');
function safeRaceEdges(world: World) {
  let safe = safeRaceCache.get(world);
  if (!safe) {
    const margin = world.edges.reduce(
      (m, e) => Math.max(m, e.width / 2 + 110),
      120,
    );
    safe = new Set(
      world.edges
        .filter(
          (e) =>
            !e.blocked && raceRoad(e) && routeHasCoverage(e.points, world.loadedTiles, world.center, margin),
        )
        .map((e) => e.id),
    );
    safeRaceCache.set(world, safe);
  }
  return safe;
}
function shortest(
  world: World,
  first: Edge,
  target: number,
  forbidden = new Set<number>(),
  historyAtFirst?: number[],
): number[] | null {
  const safe = safeRaceEdges(world);
  if (!safe.has(first.id)) return null;
  // Дейкстра по направленным рёбрам: состояние сохраняет въезд для запретов поворота.
  const initialHistory =
    historyAtFirst ?? advanceTurnHistory(world, [], first.way);
  const states = [{ edge: first.id, history: initialHistory }],
    stateIds = new Map<string, number>([
      [`${first.id}:${initialHistory.join(',')}`, 0],
    ]);
  const heap: [number, number][] = [],
    costs = new Map<number, number>([[0, 0]]),
    prev = new Map<number, number>();
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  push([0, 0]);
  while (heap.length) {
    const [cost, id] = pop(),
      state = states[id],
      edge = world.edges[state.edge];
    if (cost !== costs.get(id)) continue;
    if (
      edge.to === target &&
      id !== 0 &&
      (target !== first.from || allowedTurn(world, edge, first, state.history))
    ) {
      const route = [edge.id];
      let current = id;
      while (current !== 0) {
        current = prev.get(current)!;
        route.push(states[current].edge);
      }
      return route.reverse();
    }
    for (const next of outgoing(world, edge.to)) {
      if (
        !safe.has(next.id) ||
        forbidden.has(next.id) ||
        next.to === edge.from ||
        !allowedTurn(world, edge, next, state.history)
      )
        continue;
      const history = advanceTurnHistory(world, state.history, next.way),
        key = `${next.id}:${history.join(',')}`;
      let nextId = stateIds.get(key);
      if (nextId === undefined) {
        nextId = states.length;
        states.push({ edge: next.id, history });
        stateIds.set(key, nextId);
      }
      const nc = cost + next.length;
      if (nc >= (costs.get(nextId) ?? Infinity)) continue;
      costs.set(nextId, nc);
      prev.set(nextId, id);
      push([nc, nextId]);
    }
  }
  return null;
}
const routeCache = new WeakMap<World, Map<string, Route[]>>();
export function invalidateRaceRoutes(world: World) {
  safeRaceCache.delete(world);
  routeCache.delete(world);
}
export function createRoutes(
  world: World,
  startEdge = world.spawnEdge,
  expandCircuit = false,
): Route[] {
  if (startEdge === null) return [];
  const startIndex = edgeIndex(world, startEdge);
  if (startIndex === undefined) return [];
  const safe = safeRaceEdges(world);
  if (!safe.has(startIndex)) return [];
  let cache = routeCache.get(world);
  if (!cache) {
    cache = new Map();
    routeCache.set(world, cache);
  }
  const cacheKey = `${startEdge}/${expandCircuit}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const first = world.edges[startIndex],
    routes: Route[] = [];
  function add(kind: 'sprint' | 'circuit', ids: number[]) {
    if (kind === 'circuit') {
      let history = advanceTurnHistory(world, [], world.edges[ids[0]].way);
      for (let i = 1; i < ids.length * 2; i++) {
        const from = world.edges[ids[(i - 1) % ids.length]],
          to = world.edges[ids[i % ids.length]];
        if (!allowedTurn(world, from, to, history)) return;
        history = advanceTurnHistory(world, history, to.way);
      }
    }
    const raw: Point[] = [];
    for (const id of ids)
      raw.push(...world.edges[id].points.slice(raw.length ? 1 : 0));
    // Контрольные точки по 70 м, с обязательными углами маршрута.
    const points = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const a = raw[i - 1],
        b = raw[i],
        c = raw[i + 1];
      const turn =
        Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) /
        (distance2(a, b) * distance2(b, c) || 1);
      if (distance2(points.at(-1)!, b) > 65 || turn > 0.1) points.push(b);
    }
    points.push(raw.at(-1)!);
    const cumulative = pathLengths(points),
      length = cumulative.at(-1)!;
    if (length < 400) return;
    if (
      !routeHasCoverage(
        points,
        world.loadedTiles,
        world.center,
        Math.max(120, ...ids.map((id) => world.edges[id].width / 2 + 110)),
      )
    )
      return;
    let hash = 2166136261;
    for (const id of ids) {
      const e = world.edges[id];
      for (const c of `${e.way}/${e.from}/${e.to};`)
        hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    }
    routes.push({
      id: `${kind}-${first.way}-${first.from}-${first.to}-${(hash >>> 0).toString(36)}`,
      title: kind === 'circuit' ? 'Ночной круг' : 'Через район',
      kind,
      edges: ids.map((id) => edgeStableId(world.edges[id])),
      points,
      cumulative,
      length,
      laps: kind === 'circuit' ? 3 : 1,
    });
  }
  const reachable = new Set<number>(),
    queue = [first.to];
  while (queue.length) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing(world, id))
      if (safe.has(edge.id) && !reachable.has(edge.to)) queue.push(edge.to);
  }
  const distant = world.nodes
    .filter(
      (n) =>
        reachable.has(n.id) &&
        outgoing(world, n.id).some((e) => safe.has(e.id)),
    )
    .sort(
      (a, b) => distance2(b, first.points[0]) - distance2(a, first.points[0]),
    );
  for (const target of distant.slice(0, 8)) {
    const path = shortest(world, first, target.id);
    if (!path) continue;
    if (!routes.some((r) => r.kind === 'sprint')) add('sprint', path);
    if (!expandCircuit) {
      if (routes.some((r) => r.kind === 'sprint')) break;
      continue;
    }
    let history: number[] = [];
    for (const id of path)
      history = advanceTurnHistory(world, history, world.edges[id].way);
    const back = shortest(
      world,
      world.edges[path.at(-1)!],
      first.from,
      new Set(path),
      history,
    );
    if (back) {
      add('circuit', [...path, ...back.slice(1)]);
      if (routes.some((r) => r.kind === 'circuit')) break;
    }
  }
  if (!routes.some((r) => r.kind === 'circuit')) {
    const ring = shortest(world, first, first.from);
    if (ring) add('circuit', ring);
  }
  routes.sort((a, b) => a.kind.localeCompare(b.kind));
  cache.set(cacheKey, routes);
  return routes;
}

// Один распределённый старт на километровый участок; возле исходного старта
// оставляем оба вида гонки. Выбор детерминирован, старые доступные старты сохраняются.
export function createRaceLocations(
  world: World,
  preferredStarts: string[] = [],
): Route[] {
  const safe = safeRaceEdges(world),
    groups = new Map<string, Edge[]>();
  const cell = (e: Edge) =>
    `${Math.floor(e.points[0].x / 1000)},${Math.floor(e.points[0].z / 1000)}`;
  const preferred = new Map<string, number>();
  for (const id of preferredStarts) {
    const e = edgeById(world, id);
    if (e && safe.has(e.id) && !preferred.has(cell(e)))
      preferred.set(cell(e), e.id);
  }
  for (const e of world.edges)
    if (safe.has(e.id) && !e.bridge && !e.tunnel && e.length >= 15) {
      const key = cell(e),
        list = groups.get(key) || [];
      list.push(e);
      groups.set(key, list);
    }
  const spawn = world.spawnEdge ? edgeById(world, world.spawnEdge) : undefined;
  if (spawn && safe.has(spawn.id)) {
    const key = cell(spawn);
    if (!preferred.has(key)) preferred.set(key, spawn.id);
    if (!groups.has(key)) groups.set(key, [spawn]);
  }
  const result: Route[] = [];
  for (const [key, edges] of [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 36)) {
    const [x, z] = key.split(',').map(Number);
    const score = (e: Edge) =>
      distance2(e.points[0], {
        x: (x + 0.5) * 1000,
        y: 0,
        z: (z + 0.5) * 1000,
      }) +
      (e.category === 'service' ? 2000 : 0) +
      (e.width < 6 ? 800 : 0);
    const candidates = edges
      .sort(
        (a, b) =>
          score(a) - score(b) ||
          a.way - b.way ||
          a.from - b.from ||
          a.to - b.to,
      )
      .slice(0, 3)
      .map((e) => e.id);
    const old = preferred.get(key);
    if (old !== undefined) candidates.unshift(old);
    for (const id of new Set(candidates)) {
      const routes = createRoutes(world, edgeStableId(world.edges[id]));
      if (!routes.length) continue;
      if (spawn && key === cell(spawn)) result.push(...routes);
      else {
        const kind = Math.abs(x + z) % 2 ? 'sprint' : 'circuit';
        result.push(routes.find((r) => r.kind === kind) || routes[0]);
      }
      break;
    }
  }
  return result;
}

export function createRaceRoute(
  world: World,
  start: string,
  kind: Route['kind'],
): Route | undefined {
  const edge = edgeById(world, start);
  if (!edge) return;
  return createRoutes(world, edgeStableId(edge), true).find((r) => r.kind === kind);
}
