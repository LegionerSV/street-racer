import earcut from 'earcut';
import { dashSpans, periodicOffsets } from './markings';
import type { Building, ChunkData, Edge, MeshData, Point, Settings, World } from './types';
import { CHUNK_SIZE, distance2, mixPoint, polygonContains, projectOnSegment, sampleElevation, seeded, smooth, tileKey } from './geo';

export class ChunkBudget<T> {
  private entries = new Map<string, T>();
  constructor(public limit: number) {}
  setLimit(limit:number){this.limit=Math.max(1,Math.floor(limit));while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value!);}
  get size() { return this.entries.size; }
  has(key: string) { return this.entries.has(key); }
  get(key: string) { const item = this.entries.get(key); if (item !== undefined) this.touch(key, item); return item; }
  touch(key: string, value: T) { this.entries.delete(key); this.entries.set(key, value); while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!); }
}
export function desiredChunks(p: Point, heading: number, quality: Settings['quality']) {
  const mobile=quality==='mobile',detail=mobile?250:500;
  const far = mobile ? 650 : quality === 'high' ? 1500 : quality === 'medium' ? 1100 : 800;
  const result: { key: string; lod: number; priority: number }[] = [];
  for (let x = -10; x < 10; x++) for (let z = -10; z < 10; z++) {
    const center = { x: (x + .5) * CHUNK_SIZE, y: 0, z: (z + .5) * CHUNK_SIZE }, d = distance2(center, p);
    if (d > far + 177) continue;
    const forward = ((center.x - p.x) * Math.sin(heading) + (center.z - p.z) * Math.cos(heading)) / (d || 1);
    result.push({ key: `${x},${z}`, lod: d <= detail + 177 ? 0 : mobile ? 2 : 1, priority: d - forward * 140 });
  }
  return result.sort((a, b) => a.priority - b.priority);
}

const empty = (): MeshData => ({ positions: [], indices: [], colors: [] });
type Colour = [number, number, number];
function quad(mesh: MeshData, a: Point, b: Point, c: Point, d: Point, colour?: Colour) {
  const base = mesh.positions.length / 3;
  mesh.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  if (colour) for (let i = 0; i < 4; i++) mesh.colors!.push(...colour, 1);
}
function box(mesh: MeshData, p: Point, w: number, h: number, depth: number, color: Colour) {
  const a = { x: p.x - w / 2, y: p.y, z: p.z - depth / 2 }, b = { ...a, x: p.x + w / 2 }, c = { ...b, z: p.z + depth / 2 }, d = { ...a, z: c.z };
  const up = (v: Point) => ({ ...v, y: v.y + h });
  quad(mesh, a, b, up(b), up(a), color); quad(mesh, b, c, up(c), up(b), color); quad(mesh, c, d, up(d), up(c), color); quad(mesh, d, a, up(a), up(d), color); quad(mesh, up(a), up(b), up(c), up(d), color);
}
function ribbon(mesh: MeshData, a: Point, b: Point, left: number, right: number, up = 0, color?: Colour, na?: { x: number; z: number }, nb?: { x: number; z: number }) {
  const length = distance2(a, b) || 1, nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
  const offset = (p: Point, n: number) => { const normal = p === a ? na : nb; return { x: p.x + (normal?.x ?? nx) * n, y: p.y + up, z: p.z + (normal?.z ?? nz) * n }; };
  quad(mesh, offset(a, left), offset(b, left), offset(b, right), offset(a, right), color);
}
type Segment = { a: Point; b: Point; edge: Edge; index: number; station: number; na?: { x: number; z: number }; nb?: { x: number; z: number } };
type Index = { segments: Map<string, Segment[]>; owned: Map<string, Segment[]>; buildings: Map<string, Building[]>; junctions: Set<number> };
const worldIndices = new WeakMap<World, Index>();
function clipToChunk(polygon: Point[], x0: number, z0: number): Point[] {
  for (const [axis, bound, sign] of [['x', x0, 1], ['x', x0 + 250, -1], ['z', z0, 1], ['z', z0 + 250, -1]] as const) {
    const output: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], ain = (a[axis] - bound) * sign >= 0, bin = (b[axis] - bound) * sign >= 0;
      if (ain) output.push(a);
      if (ain !== bin) output.push(mixPoint(a, b, (bound - a[axis]) / (b[axis] - a[axis])));
    }
    polygon = output;
  }
  return polygon;
}
export function indexWorld(world: World): Index {
  const existing = worldIndices.get(world); if (existing) return existing;
  const index: Index = { segments: new Map(), owned: new Map(), buildings: new Map(), junctions: new Set() }, seen = new Set<string>();
  const links = new Map<number, Set<number>>(), normals = new Map<string, { x: number; z: number; count: number }>();
  const endpoints = new Map<number, { normal: { x: number; z: number }; x: number; z: number; sign: number }[]>();
  const normalAt = (edge: Edge, p: Point, x: number, z: number) => { const key = `${edge.way}/${p.x.toFixed(3)}/${p.y.toFixed(3)}/${p.z.toFixed(3)}`, normal = normals.get(key) || { x: 0, z: 0, count: 0 }; normal.x += x; normal.z += z; normal.count++; normals.set(key, normal); return normal; };
  for (const edge of world.edges) {
    const id = `${edge.way}/${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`;
    if (seen.has(id)) continue; seen.add(id);
    for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) { const neighbours = links.get(a) || new Set<number>(); neighbours.add(b); links.set(a, neighbours); }
    let station = edge.markingStart || 0;
    for (let i = 0; i < edge.points.length - 1; i++) {
      const a = edge.points[i], b = edge.points[i + 1], length = distance2(a, b) || 1, nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
      const segment: Segment = { a, b, edge, index: i, station, na: normalAt(edge, a, nx, nz), nb: normalAt(edge, b, nx, nz) };
      for (const [id, normal, sign] of [[i === 0 ? edge.from : null, segment.na!, 1], [i === edge.points.length - 2 ? edge.to : null, segment.nb!, -1]] as const) if (id !== null) {
        const list = endpoints.get(id) || []; list.push({ normal, x: nx * sign, z: nz * sign, sign }); endpoints.set(id, list);
      }
      station += length * (edge.laneProfile?.direction || 1);
      const key = tileKey((a.x + b.x) / 2, (a.z + b.z) / 2), list = index.owned.get(key) || []; list.push(segment); index.owned.set(key, list);
      const extra = edge.width / 2 + 35;
      for (let x = Math.floor((Math.min(a.x, b.x) - extra) / 250); x <= Math.floor((Math.max(a.x, b.x) + extra) / 250); x++) for (let z = Math.floor((Math.min(a.z, b.z) - extra) / 250); z <= Math.floor((Math.max(a.z, b.z) + extra) / 250); z++) {
        const k = `${x},${z}`, candidates = index.segments.get(k) || []; candidates.push(segment); index.segments.set(k, candidates);
      }
    }
  }
  for (const [id, neighbours] of links) if (neighbours.size > 2) index.junctions.add(id);
  for (const normal of normals.values()) { normal.x /= normal.count; normal.z /= normal.count; const square = normal.x * normal.x + normal.z * normal.z; const factor = Math.min(1 / (square || 1), 1.8 / (Math.sqrt(square) || 1)); normal.x *= factor; normal.z *= factor; }
  // Стык двух way тоже имеет общие поперечные вершины. Учитываем направление
  // каждого торца, в том числе когда один OSM-путь записан задом наперёд.
  for (const [id, ends] of endpoints) if (links.get(id)?.size === 2 && ends.length === 2 && ends[0].normal !== ends[1].normal) {
    const [a, b] = ends, x = (a.x - b.x) / 2, z = (a.z - b.z) / 2, square = x * x + z * z;
    const factor = Math.min(1 / (square || 1), 1.8 / (Math.sqrt(square) || 1));
    a.normal.x = x * factor * a.sign; a.normal.z = z * factor * a.sign;
    b.normal.x = -x * factor * b.sign; b.normal.z = -z * factor * b.sign;
  }
  for (const b of world.buildings) {
    const center = b.footprint.reduce((a, p) => ({ x: a.x + p.x / b.footprint.length, y: 0, z: a.z + p.z / b.footprint.length }), { x: 0, y: 0, z: 0 });
    const key = tileKey(center.x, center.z), list = index.buildings.get(key) || []; list.push(b); index.buildings.set(key, list);
  }
  worldIndices.set(world, index); return index;
}

export function buildChunk(world: World, key: string, lod: number): ChunkData {
  const index = indexWorld(world), segments = index.segments.get(key) || [], owned = index.owned.get(key) || [];
  const [cx, cz] = key.split(',').map(Number), x0 = cx * 250, z0 = cz * 250;
  const result: ChunkData = { key, lod, terrain: empty(), road: empty(), shoulders: empty(), markings: empty(), structures: empty(), buildings: empty(), windows: empty(), water: empty(), trees: [], lamps: [] };
  const waters = world.areas.filter(area => area.kind === 'water' && !area.points.every(p => p.x < x0 - 20) && !area.points.every(p => p.x > x0 + 270) && !area.points.every(p => p.z < z0 - 20) && !area.points.every(p => p.z > z0 + 270));
  const waterLevel = (area: World['areas'][number]) => Math.min(...area.points.map(p => p.y)) - .4;
  // Одинаковая сетка на обоих LOD сохраняет стыки; различается детализация объектов.
  const n = 20, terrain = result.terrain;
  function ground(x: number, z: number) {
    const y = sampleElevation(world.elevation, x, z); let best = Infinity, roadHeight = y;
    for (const s of segments) if (!s.edge.bridge && !s.edge.tunnel) {
      const projected = projectOnSegment({ x, y: 0, z }, s.a, s.b), limit = s.edge.width / 2 + 14;
      if (projected.distance < limit && projected.distance < best) { best = projected.distance; roadHeight = y + (projected.point.y - .3 - y) * (1 - smooth((projected.distance - s.edge.width / 2 - 3) / 11)); }
    }
    // Опускаем все вершины пересекающей полотно ячейки, включая её диагональ.
    for (const s of segments) if (!s.edge.bridge && !s.edge.tunnel && projectOnSegment({ x, y: 0, z }, s.a, s.b).distance < s.edge.width / 2 + 19) roadHeight = Math.min(roadHeight, Math.min(s.a.y, s.b.y) - .65);
    const p = { x, y: 0, z };
    for (const area of waters) {
      const inside = polygonContains(p, area.points) && !(area.holes || []).some(h => polygonContains(p, h));
      const bank = [area.points, ...(area.holes || [])].some(ring => ring.some((a, i) => projectOnSegment(p, a, ring[(i + 1) % ring.length]).distance < 18));
      if (inside || bank) roadHeight = Math.min(roadHeight, waterLevel(area) - 3);
    }
    return roadHeight;
  }
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = x0 + i * 250 / n, z = z0 + j * 250 / n, y = ground(x, z);
    terrain.positions.push(x, y, z); const shade = .9 + seeded(Math.round(x * 7 + z * 13)) * .16;
    terrain.colors!.push(.105 * shade, .16 * shade, .125 * shade, 1);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = { x: x0 + (i + .5) * 250 / n, y: 0, z: z0 + (j + .5) * 250 / n };
    // У входов в тоннель вырезаем землю. Над глубокими участками поверхность сохраняется.
    const portal = segments.some(s => s.edge.tunnel && projectOnSegment(p, s.a, s.b).distance < s.edge.width / 2 + 10 && sampleElevation(world.elevation, p.x, p.z) < projectOnSegment(p, s.a, s.b).point.y + 6);
    if (portal) continue;
    const k = j * (n + 1) + i; terrain.indices.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2);
  }
  const circles = new Set<string>();
  const terrainHeight = (x: number, z: number) => {
    const gx = x / 12.5, gz = z / 12.5, ix = Math.floor(gx), iz = Math.floor(gz), tx = gx - ix, tz = gz - iz;
    const h = (a: number, b: number) => ground(a * 12.5, b * 12.5);
    return tx + tz <= 1 ? h(ix, iz) * (1 - tx - tz) + h(ix + 1, iz) * tx + h(ix, iz + 1) * tz : h(ix + 1, iz + 1) * (tx + tz - 1) + h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz) * (1 - tz);
  };
  for (const s of owned) {
    const { a, b, edge } = s, w = edge.width / 2;
    if (!edge.bridge && !edge.tunnel) for (const side of [-1, 1]) {
      const len = distance2(a, b) || 1, normal = { x: (b.z - a.z) / len, z: -(b.x - a.x) / len };
      const offset = (p: Point, n: {x:number;z:number}, d: number) => ({ x:p.x+n.x*d*side, y:p.y-.08, z:p.z+n.z*d*side });
      const aa = offset(a, s.na || normal, w + 1.3), bb = offset(b, s.nb || normal, w + 1.3);
      const cc = offset(b, s.nb || normal, w + 7), dd = offset(a, s.na || normal, w + 7);
      cc.y = terrainHeight(cc.x,cc.z) + .02; dd.y = terrainHeight(dd.x,dd.z) + .02;
      if(side>0)quad(result.shoulders,aa,bb,cc,dd,[.23,.27,.22]);else quad(result.shoulders,dd,cc,bb,aa,[.23,.27,.22]);
    }
    ribbon(result.road, a, b, -w - 1.3, w + 1.3, -.08, [.29, .32, .34], s.na, s.nb);
    ribbon(result.road, a, b, -w, w, 0, [.18, .21, .24], s.na, s.nb);
    // Площадки нужны только на перекрёстках. На склонах полотно сшивается боковыми вершинами.
    const junctionPoints = [s.index === 0 && index.junctions.has(edge.from) ? a : null, s.index === edge.points.length - 2 && index.junctions.has(edge.to) ? b : null].filter(Boolean) as Point[];
    for (const p of junctionPoints) {
      const id = `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.y.toFixed(2)}`;
      if (circles.has(id)) continue; circles.add(id);
      for (let k = 0; k < 12; k++) {
        const base = result.road.positions.length / 3, aa = k / 12 * Math.PI * 2, bb = (k + 1) / 12 * Math.PI * 2;
        result.road.positions.push(p.x, p.y - .015, p.z, p.x + Math.cos(aa) * w, p.y - .015, p.z + Math.sin(aa) * w, p.x + Math.cos(bb) * w, p.y - .015, p.z + Math.sin(bb) * w);
        result.road.indices.push(base, base + 2, base + 1); for (let l = 0; l < 3; l++) result.road.colors!.push(.18, .21, .24, 1);
      }
    }
    const crossing = segments.some(other => other.edge.way !== edge.way && other.edge.layer === edge.layer && Math.abs(other.a.y - a.y) < 2 && projectOnSegment(mixPoint(a,b,.5),other.a,other.b).distance < other.edge.width/2 + 1);
    if (lod === 0 && !crossing) {
      ribbon(result.markings, a, b, -w + .25, -w + .36, .045, [.85, .87, .83], s.na, s.nb); ribbon(result.markings, a, b, w - .36, w - .25, .045, [.85, .87, .83], s.na, s.nb);
      const separators = edge.laneProfile?.separators || Array.from({length:Math.max(0,edge.lanes-1)},(_,i)=>({offset:-w+(i+1)*edge.width/edge.lanes,kind:'lane' as const}));
      const length = distance2(a,b);
      for(const line of separators) for(const [start,end] of dashSpans(s.station,length,edge.laneProfile?.direction || 1)){
        const normal=(t:number)=>s.na&&s.nb?{x:s.na.x+(s.nb.x-s.na.x)*t,z:s.na.z+(s.nb.z-s.na.z)*t}:undefined;
        const half=line.kind==='divider'?.075:.055;
        ribbon(result.markings,mixPoint(a,b,start/length),mixPoint(a,b,end/length),line.offset-half,line.offset+half,.05,[.82,.84,.8],normal(start/length),normal(end/length));
      }
    }
    if (edge.bridge) {
      ribbon(result.structures, a, b, -w - .7, w + .7, -.55, [.24, .29, .3]);
      for (const side of [-1, 1]) {
        const length = distance2(a, b), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
        const aa = { x: a.x + nx * (w + .4) * side, y: a.y, z: a.z + nz * (w + .4) * side }, bb = { x: b.x + nx * (w + .4) * side, y: b.y, z: b.z + nz * (w + .4) * side };
        quad(result.structures, aa, bb, { ...bb, y: bb.y + 1.1 }, { ...aa, y: aa.y + 1.1 }, [.37, .41, .41]);
      }
      for (const d of periodicOffsets(s.station, distance2(a, b), edge.laneProfile?.direction || 1, 70, 35)) { const p = mixPoint(a, b, d / distance2(a, b)), base = sampleElevation(world.elevation, p.x, p.z); if (p.y - base > 2) box(result.structures, { ...p, y: base }, 1.4, p.y - base - .5, 1.4, [.23, .27, .28]); }
    }
    if (edge.tunnel) {
      const length = distance2(a, b), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
      const offset = (p: Point, side: number) => ({ x: p.x + nx * (w + 1) * side, y: p.y - .3, z: p.z + nz * (w + 1) * side });
      for (const side of [-1, 1]) { const aa = offset(a, side), bb = offset(b, side); quad(result.structures, aa, bb, { ...bb, y: bb.y + 6 }, { ...aa, y: aa.y + 6 }, [.26, .29, .28]); }
      ribbon(result.structures, a, b, -w - 1, w + 1, 5.7, [.25, .28, .27]);
      if (lod === 0) for (const [start, end] of dashSpans(s.station, length, edge.laneProfile?.direction || 1, 30, 3)) ribbon(result.windows, mixPoint(a, b, start / length), mixPoint(a, b, end / length), w - .4, w - .1, 5.6, [.7, .85, .85]);
    }
    if (edge.blocked && s.index === 0 && Math.abs(a.x) < 2490 && Math.abs(a.z) < 2490) {
      const length = distance2(a, b), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
      for (let k = -Math.floor(w / 1.4); k <= Math.floor(w / 1.4); k++) box(result.structures, { x: a.x + nx * k * 1.4, y: a.y, z: a.z + nz * k * 1.4 }, 1.3, .9, 1.3, k % 2 ? [.8, .33, .12] : [.67, .68, .58]);
    }
    if (lod === 0 && !edge.tunnel) for (const d of periodicOffsets(s.station, distance2(a, b), edge.laneProfile?.direction || 1)) {
      const l = distance2(a, b), anchor = mixPoint(a, b, d / l), p = { x: anchor.x + (b.z - a.z) / l * (w + 1.6), y: anchor.y, z: anchor.z - (b.x - a.x) / l * (w + 1.6) };
      const free = segments.every(other => Math.abs(other.a.y-p.y)>3 || projectOnSegment(p,other.a,other.b).distance > other.edge.width/2+.6);
      if (free) { box(result.structures, p, .12, 7, .12, [.2, .25, .25]); box(result.windows, { ...p, y: p.y + 7 }, .7, .12, 1.4, [.85, .82, .55]); result.lamps.push({ ...p, y: p.y + 6.7 }); }
    }
  }
  for (const building of index.buildings.get(key) || []) {
    const outline = building.footprint, floor = Math.min(...outline.map(p => p.y)) + (building.minHeight || 0) - .3, top = Math.max(...outline.map(p => p.y)) + building.height;
    const tone = .21 + building.colour * .13, color: Colour = [tone * 1.04, tone * 1.01, tone * .94];
    const rings = [outline, ...(building.holes || [])];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = { ...ring[i], y: floor }, b = { ...ring[(i + 1) % ring.length], y: floor };
      quad(result.buildings, a, b, { ...b, y: top }, { ...a, y: top }, color);
      if (lod <= 1) {
        const area = ring.reduce((sum,p,j)=>sum+p.x*ring[(j+1)%ring.length].z-ring[(j+1)%ring.length].x*p.z,0);
        const outward = (area > 0 ? 1 : -1) * (ring === outline ? 1 : -1);
        const length = distance2(a, b), columns = Math.floor(length / 3.7), floors = Math.min(45, Math.floor((top - floor) / 3.2));
        const offset = { x: (b.z - a.z) / (length || 1) * .09 * outward, z: -(b.x - a.x) / (length || 1) * .09 * outward };
        for (let level = 0; level < floors; level++) for (let col = 0; col < columns; col++) {
          if (seeded(building.id + level * 117 + col * 31 + i * 93) < .42) continue;
          const aa = mixPoint(a, b, (col + .25) / columns), bb = mixPoint(a, b, (col + .7) / columns);
          aa.x += offset.x; aa.z += offset.z; bb.x += offset.x; bb.z += offset.z; aa.y = bb.y = floor + level * 3.2 + 1.5;
          quad(result.windows, aa, bb, { ...bb, y: bb.y + 1.3 }, { ...aa, y: aa.y + 1.3 }, seeded(building.id + col) > .65 ? [.36, .61, .64] : [.72, .57, .32]);
        }
      }
    }
    const flat = rings.flatMap(r => r.flatMap(p => [p.x, p.z])), holes: number[] = [];
    let count = outline.length; for (const ring of rings.slice(1)) { holes.push(count); count += ring.length; }
    const triangles = earcut(flat, holes), base = result.buildings.positions.length / 3;
    for (let i = 0; i < flat.length; i += 2) { result.buildings.positions.push(flat[i], top, flat[i + 1]); result.buildings.colors!.push(tone * .65, tone * .7, tone * .72, 1); }
    result.buildings.indices.push(...triangles.map(i => i + base));
    if ((building.minHeight || 0) > 0) { const underside=result.buildings.positions.length/3;for(let i=0;i<flat.length;i+=2){result.buildings.positions.push(flat[i],floor,flat[i+1]);result.buildings.colors!.push(tone*.65,tone*.65,tone*.65,1);}for(let i=0;i<triangles.length;i+=3)result.buildings.indices.push(underside+triangles[i+2],underside+triangles[i+1],underside+triangles[i]); }
  }
  for (const area of world.areas) {
    const minx = Math.min(...area.points.map(p => p.x)), maxx = Math.max(...area.points.map(p => p.x)), minz = Math.min(...area.points.map(p => p.z)), maxz = Math.max(...area.points.map(p => p.z));
    if (maxx < x0 || minx > x0 + 250 || maxz < z0 || minz > z0 + 250) continue;
    if (area.kind === 'water') {
      const y = waterLevel(area), rings = [area.points, ...(area.holes || [])], vertices = rings.flat(), holes: number[] = [];
      let count = area.points.length; for (const hole of rings.slice(1)) { holes.push(count); count += hole.length; }
      const triangles = earcut(vertices.flatMap(p => [p.x, p.z]), holes);
      for (let i = 0; i < triangles.length; i += 3) {
        const clipped = clipToChunk(triangles.slice(i, i + 3).map(index => ({ ...vertices[index], y })), x0, z0), base = result.water.positions.length / 3;
        for (const p of clipped) result.water.positions.push(p.x, p.y, p.z);
        for (let j = 1; j < clipped.length - 1; j++) result.water.indices.push(base, base + j, base + j + 1);
      }
    } else if (lod === 0) {
      for (let i = 0; i < 24; i++) {
        const p = { x: x0 + seeded(area.id + cx * 771 + cz * 991 + i * 31) * 250, y: 0, z: z0 + seeded(area.id + cx * 887 + cz * 773 + i * 87) * 250 };
        if (!polygonContains(p, area.points) || (area.holes || []).some(h => polygonContains(p, h)) || segments.some(s => projectOnSegment(p, s.a, s.b).distance < s.edge.width / 2 + 3)) continue;
        p.y = ground(p.x, p.z); result.trees.push(p);
      }
    }
  }
  if (lod === 0) for (const tree of world.trees) if (tileKey(tree.x, tree.z) === key && segments.every(s => projectOnSegment(tree,s.a,s.b).distance > s.edge.width/2+2)) result.trees.push({ ...tree, y: ground(tree.x,tree.z) });
  return result;
}
