import earcut from 'earcut';
import { bridgeRailingSpans } from './bridge-railings';
import { coverageBounds } from './stream-coverage';
import { carriagewayJoin, type CarriagewayJoin } from './carriageways';
import { cutSoil } from './terrain-cutouts';
import { SpatialGrid,boundsOf,roadPrism,footprintPrism,subtractPrisms,type Prism } from './geometry';
import { appendBuilding } from './buildings';
import { worldLandmarks,appendLandmark } from './landmarks';
import { dashSpans, periodicOffsets } from './markings';
import { BRIDGE_DECK_THICKNESS, SIDEWALK_WIDTH, CURB_WIDTH, CURB_HEIGHT } from './clearance';
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
export function desiredChunks(p: Point, heading: number, quality: Settings['quality'], streaming = false) {
  const mobile=quality==='mobile',detail=mobile?250:500;
  const far = mobile ? 650 : quality === 'high' ? 1500 : quality === 'medium' ? 1100 : 800;
  const result: { key: string; lod: number; priority: number }[] = [];
  const reach = Math.ceil((far + 177) / CHUNK_SIZE), cx = Math.floor(p.x/CHUNK_SIZE), cz = Math.floor(p.z/CHUNK_SIZE);
  for (let x = streaming ? cx-reach : -10; x < (streaming ? cx+reach+1 : 10); x++) for (let z = streaming ? cz-reach : -10; z < (streaming ? cz+reach+1 : 10); z++) {
    const center = { x: (x + .5) * CHUNK_SIZE, y: 0, z: (z + .5) * CHUNK_SIZE }, d = distance2(center, p);
    if (d > far + 177) continue;
    const forward = ((center.x - p.x) * Math.sin(heading) + (center.z - p.z) * Math.cos(heading)) / (d || 1);
    result.push({ key: `${x},${z}`, lod: d <= detail + 177 ? 0 : mobile ? 2 : 1, priority: d - forward * 140 });
  }
  return result.sort((a, b) => a.priority - b.priority);
}

// До начала движения нужны коллизии под машиной и впереди, включая запас
// у границы квартала; остальной район подгружается уже во время поездки.
export function criticalChunks(p:Point,heading:number,streaming=false){
  const keys=new Set<string>();
  for(const ahead of [0,70])for(const dx of [-20,20])for(const dz of [-20,20]){
    const x=Math.floor((p.x+Math.sin(heading)*ahead+dx)/CHUNK_SIZE),z=Math.floor((p.z+Math.cos(heading)*ahead+dz)/CHUNK_SIZE);
    if(streaming||(x>=-10&&x<10&&z>=-10&&z<10))keys.add(`${x},${z}`);
  }
  return [...keys];
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
type Segment = { a: Point; b: Point; edge: Edge; index: number; station: number; na?: { x: number; z: number }; nb?: { x: number; z: number }; join?: CarriagewayJoin };
type Paving={id:string;segment:Segment;side:number;mask:Prism};
const sidewalkOn = (edge: Edge, side: number) => side < 0 ? edge.sidewalkLeft !== false : edge.sidewalkRight !== false;
function segmentPolygonSpans(a:Point,b:Point,outer:Point[],holes:Point[][]=[]){
  const cuts=new Set([0,1]),dx=b.x-a.x,dz=b.z-a.z;
  for(const ring of [outer,...holes])for(let i=0;i<ring.length;i++){
    const p=ring[i],q=ring[(i+1)%ring.length],ex=q.x-p.x,ez=q.z-p.z,den=dx*ez-dz*ex;
    if(Math.abs(den)<1e-8)continue;
    const t=((p.x-a.x)*ez-(p.z-a.z)*ex)/den,u=((p.x-a.x)*dz-(p.z-a.z)*dx)/den;
    if(t>0&&t<1&&u>=0&&u<=1)cuts.add(t);
  }
  const sorted=[...cuts].sort((x,y)=>x-y),spans:[Point,Point][]=[];
  for(let i=1;i<sorted.length;i++){
    const start=mixPoint(a,b,sorted[i-1]),end=mixPoint(a,b,sorted[i]),mid=mixPoint(start,end,.5);
    if(polygonContains(mid,outer)&&!holes.some(h=>polygonContains(mid,h)))spans.push([start,end]);
  }
  return spans;
}
function sidewalkShape(s:Segment,side:number){
  const {a,b,edge}=s,length=distance2(a,b)||1,normal={x:(b.z-a.z)/length,z:-(b.x-a.x)/length},w=edge.width/2,outer=w+CURB_WIDTH+SIDEWALK_WIDTH;
  const offset=(p:Point,n:{x:number;z:number},d:number,up=CURB_HEIGHT)=>({x:p.x+n.x*d*side,y:p.y+up,z:p.z+n.z*d*side});
  const aa=(d:number,up=CURB_HEIGHT)=>offset(a,s.na||normal,d,up),bb=(d:number,up=CURB_HEIGHT)=>offset(b,s.nb||normal,d,up);
  return {aa,bb,w,outer,points:[aa(w),bb(w),bb(outer),aa(outer)]};
}
// Единое владение перекрытием: верхняя грань остаётся у одной полосы,
// а внутренние вертикальные борта убираются у обеих. Маски общие между кварталами.
function sidewalkPolygon(mesh:MeshData,polygon:Point[],colour:Colour,masks:Prism[]){
  for(const piece of subtractPrisms(polygon,masks)){
    const base=mesh.positions.length/3;for(const p of piece){mesh.positions.push(p.x,p.y,p.z);mesh.colors!.push(...colour,1);}
    for(let i=1;i<piece.length-1;i++)mesh.indices.push(base,base+i,base+i+1);
  }
}
type Index = { segments: Map<string, Segment[]>; owned: Map<string, Segment[]>; buildings: Map<string, Building[]>; junctions: Set<number>; spatial:SpatialGrid<Segment>; paving:SpatialGrid<Paving>; cavities:SpatialGrid<Prism>; ground:Map<string,number>; waters:SpatialGrid<World['areas'][number]> };
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
  const coverage=coverageBounds(world.loadedTiles);
  const index: Index = { segments: new Map(), owned: new Map(), buildings: new Map(), junctions: new Set(), spatial:new SpatialGrid(32,coverage),paving:new SpatialGrid(32,coverage),cavities:new SpatialGrid(32,coverage),ground:new Map(),waters:new SpatialGrid(250,coverage) }, seen = new Set<string>();
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
      index.spatial.add(segment,boundsOf([a,b],edge.width/2+35));
      if(edge.tunnel || edge.tunnelApproach){
        // Небольшое продольное перекрытие закрывает щели на стыках сегментов.
        const aa=mixPoint(a,b,-.25/length),bb=mixPoint(a,b,1+.25/length);
        const cavity=roadPrism(aa,bb,edge.width+2*(SIDEWALK_WIDTH+CURB_WIDTH+.2),.4,5.7);
        index.cavities.add(cavity,cavity.bounds);
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
  for(const segments of index.owned.values())for(const segment of segments){
    if(!segment.edge.oneWay || segment.edge.bridge || segment.edge.tunnel)continue;
    segment.join=carriagewayJoin(segment,index.spatial.query(boundsOf([segment.a,segment.b],segment.edge.width/2+22)),world.drivingSide);
    if(segment.join)segment.edge.combinedLanes=segment.edge.lanes+segment.join.other.lanes;
  }
  for(const segments of index.owned.values())for(const segment of segments)for(const side of [-1,1]){
    if(segment.join?.side===side)continue;
    if(!sidewalkOn(segment.edge,side))continue;
    const {points}=sidewalkShape(segment,side),{a,b}=segment,dx=b.x-a.x,dz=b.z-a.z,slope=(b.y-a.y)/(dx*dx+dz*dz||1);
    const height={x:-dx*slope,y:1,z:-dz*slope,w:-a.y-CURB_HEIGHT+(a.x*dx+a.z*dz)*slope};
    const endpoints=[`${a.x},${a.z}`,`${b.x},${b.z}`].sort().join('/');
    const paving={id:`${segment.edge.way}/${endpoints}/${side}`,segment,side,mask:footprintPrism(points,height,.6,.6)};
    index.paving.add(paving,paving.mask.bounds);
  }
  for(const area of world.areas)if(area.kind==='water')index.waters.add(area,boundsOf(area.points,18));
  for (const b of world.buildings) {
    const center = b.footprint.reduce((a, p) => ({ x: a.x + p.x / b.footprint.length, y: 0, z: a.z + p.z / b.footprint.length }), { x: 0, y: 0, z: 0 });
    const key = tileKey(center.x, center.z), list = index.buildings.get(key) || []; list.push(b); index.buildings.set(key, list);
  }
  worldIndices.set(world, index); return index;
}

export function buildChunk(world: World, key: string, lod: number): ChunkData {
  const index = indexWorld(world), segments = index.segments.get(key) || [], owned = index.owned.get(key) || [];
  const [cx, cz] = key.split(',').map(Number), x0 = cx * 250, z0 = cz * 250;
  const result: ChunkData = { key, lod, terrain: empty(), road: empty(), shoulders: empty(), sidewalks: empty(), landmarks:empty(), facades:[empty(),empty(),empty()], markings: empty(), structures: empty(), treeTrunks:empty(), buildings: empty(), windows: empty(), water: empty(), trees: [], lamps: [], breakables:[] };
  const waterLevel = (area: World['areas'][number]) => Math.min(...area.points.map(p => p.y)) - .4;
  // Одинаковая сетка на обоих LOD сохраняет стыки; различается детализация объектов.
  const n = 20, terrain = result.terrain;
  function ground(x: number, z: number) {
    const cacheKey=`${x},${z}`,cached=index.ground.get(cacheKey);if(cached!==undefined)return cached;
    const query={minX:x,maxX:x,minZ:z,maxZ:z},near=index.spatial.query(query);
    const y = sampleElevation(world.elevation, x, z); let best = Infinity, roadHeight = y;
    for (const s of near) if (!s.edge.bridge && !s.edge.tunnel) {
      const projected = projectOnSegment({ x, y: 0, z }, s.a, s.b), limit = s.edge.width / 2 + 7;
      if (projected.distance < limit && projected.distance < best) { best = projected.distance; roadHeight = y + (projected.point.y - .3 - y) * (1 - smooth((projected.distance - s.edge.width / 2 - 3) / 4)); }
    }
    const p = { x, y: 0, z };
    for (const area of index.waters.query(query)) {
      const inside = polygonContains(p, area.points) && !(area.holes || []).some(h => polygonContains(p, h));
      const bank = [area.points, ...(area.holes || [])].some(ring => ring.some((a, i) => projectOnSegment(p, a, ring[(i + 1) % ring.length]).distance < 18));
      if (inside || bank) roadHeight = Math.min(roadHeight, waterLevel(area) - 3);
    }
    index.ground.set(cacheKey,roadHeight);return roadHeight;
  }
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = x0 + i * 250 / n, z = z0 + j * 250 / n, y = ground(x, z);
    terrain.positions.push(x, y, z); const shade = .9 + seeded(Math.round(x * 7 + z * 13)) * .16;
    terrain.colors!.push(.105 * shade, .16 * shade, .125 * shade, 1);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // Треугольники вырезаются по объёму тоннеля после построения откосов,
    // без удаления целых ячеек и дыр в поверхности над крышей.
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
    const outer=w+(edge.sidewalkLeft!==false||edge.sidewalkRight!==false?CURB_WIDTH+SIDEWALK_WIDTH:.2);
    for(const side of [-1,1]){
      if(s.join?.side===side)continue;
      if(!sidewalkOn(edge,side))continue;
      const {aa,bb,points}=sidewalkShape(s,side),bounds=boundsOf(points);
      const candidates=index.paving.query(bounds),own=candidates.find(p=>p.segment===s&&p.side===side)!;
      const roads=index.spatial.query(bounds).filter(other=>other.edge.way!==edge.way).map(other=>roadPrism(other.a,other.b,other.edge.width+.5,.6,.6));
      const tops=[...roads,...candidates.filter(p=>p.id<own.id).map(p=>p.mask)];
      const walls=[...roads,...candidates.filter(p=>p!==own).map(p=>p.mask)];
      for(const [left,right,color] of [[w,w+CURB_WIDTH,[.58,.59,.57]],[w+CURB_WIDTH,outer,[.4,.42,.42]]] as [number,number,Colour][])
        sidewalkPolygon(result.sidewalks!,[aa(left),bb(left),bb(right),aa(right)],color,tops);
      sidewalkPolygon(result.sidewalks!,[aa(w,0),bb(w,0),bb(w),aa(w)],[.52,.53,.51],walls);
      sidewalkPolygon(result.sidewalks!,[aa(outer,-.08),aa(outer),bb(outer),bb(outer,-.08)],[.34,.35,.35],walls);
    }
    if (!edge.bridge && !edge.tunnel) for (const side of [-1, 1]) {
      if(s.join?.side===side)continue;
      const len = distance2(a, b) || 1, normal = { x: (b.z - a.z) / len, z: -(b.x - a.x) / len };
      const offset = (p: Point, n: {x:number;z:number}, d: number) => ({ x:p.x+n.x*d*side, y:p.y-.08, z:p.z+n.z*d*side });
      const sideOuter=w+(sidewalkOn(edge,side)?CURB_WIDTH+SIDEWALK_WIDTH:.2),aa = offset(a, s.na || normal, sideOuter), bb = offset(b, s.nb || normal, sideOuter);
      const cc = offset(b, s.nb || normal, w + 7), dd = offset(a, s.na || normal, w + 7);
      cc.y = terrainHeight(cc.x,cc.z) + .02; dd.y = terrainHeight(dd.x,dd.z) + .02;
      if(side>0)quad(result.shoulders,aa,bb,cc,dd,[.23,.27,.22]);else quad(result.shoulders,dd,cc,bb,aa,[.23,.27,.22]);
    }
    ribbon(result.road, a, b, -w - 1.3, w + 1.3, -.08, [.29, .32, .34], s.na, s.nb);
    if(s.join){
      const {nearA,nearB,farA,farB,side}=s.join;
      const centerA=mixPoint(nearA,farA,.5),centerB=mixPoint(nearB,farB,.5),length=distance2(a,b);
      const offset=(p:Point,n:{x:number;z:number}|undefined)=>({x:p.x-(n?.x??(b.z-a.z)/length)*w*side,y:p.y,z:p.z-(n?.z??-(b.x-a.x)/length)*w*side});
      const outerA=offset(a,s.na),outerB=offset(b,s.nb);
      // Каждая половина заканчивается на общей оси: и промежуток, и небольшое
      // перекрытие OSM-полотен превращаются в одну поверхность без наложений.
      if(side>0)quad(result.road,outerA,outerB,centerB,centerA,[.18,.21,.24]);
      else quad(result.road,centerA,centerB,outerB,outerA,[.18,.21,.24]);
      if(lod===0&&s.join.owner)ribbon(result.markings,centerA,centerB,-.075,.075,.05,[.82,.84,.8]);
    }else ribbon(result.road, a, b, -w, w, 0, [.18, .21, .24], s.na, s.nb);
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
      if(s.join?.side!==-1)ribbon(result.markings, a, b, -w + .25, -w + .36, .045, [.85, .87, .83], s.na, s.nb);
      if(s.join?.side!==1)ribbon(result.markings, a, b, w - .36, w - .25, .045, [.85, .87, .83], s.na, s.nb);
      const separators = edge.laneProfile?.separators || Array.from({length:Math.max(0,edge.lanes-1)},(_,i)=>({offset:-w+(i+1)*edge.width/edge.lanes,kind:'lane' as const}));
      const length = distance2(a,b);
      for(const line of separators) for(const [start,end] of dashSpans(s.station,length,edge.laneProfile?.direction || 1)){
        const normal=(t:number)=>s.na&&s.nb?{x:s.na.x+(s.nb.x-s.na.x)*t,z:s.na.z+(s.nb.z-s.na.z)*t}:undefined;
        const half=line.kind==='divider'?.075:.055;
        ribbon(result.markings,mixPoint(a,b,start/length),mixPoint(a,b,end/length),line.offset-half,line.offset+half,.05,[.82,.84,.8],normal(start/length),normal(end/length));
      }
    }
    if (edge.bridge) {
      ribbon(result.structures, a, b, -outer, outer, -BRIDGE_DECK_THICKNESS, [.24, .29, .3],s.na,s.nb);
      for (const side of [-1, 1]) {
        const length = distance2(a, b), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
        const aa = { x: a.x + (s.na?.x??nx) * outer * side, y: a.y, z: a.z + (s.na?.z??nz) * outer * side }, bb = { x: b.x + (s.nb?.x??nx) * outer * side, y: b.y, z: b.z + (s.nb?.z??nz) * outer * side };
        for(const rail of bridgeRailingSpans(aa,bb,edge,index.spatial.query(boundsOf([aa,bb],.2))))
          quad(result.structures, rail.a, rail.b, { ...rail.b, y: rail.b.y + 1.1 }, { ...rail.a, y: rail.a.y + 1.1 }, [.37, .41, .41]);
      }
      for (const d of periodicOffsets(s.station, distance2(a, b), edge.laneProfile?.direction || 1, 70, 35)) { const p = mixPoint(a, b, d / distance2(a, b)), base = sampleElevation(world.elevation, p.x, p.z); const free=segments.every(other=>other.edge.layer>=edge.layer||projectOnSegment(p,other.a,other.b).distance>other.edge.width/2+SIDEWALK_WIDTH+1); if (free&&p.y - base > 2) box(result.structures, { ...p, y: base }, 1.4, p.y - base - BRIDGE_DECK_THICKNESS, 1.4, [.23, .27, .28]); }
    }
    if (edge.tunnel) {
      const length = distance2(a, b), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
      const offset = (p: Point, side: number) => ({ x: p.x + nx * (outer+.2) * side, y: p.y - .3, z: p.z + nz * (outer+.2) * side });
      for (const side of [-1, 1]) { const aa = offset(a, side), bb = offset(b, side); quad(result.structures, aa, bb, { ...bb, y: bb.y + 6 }, { ...aa, y: aa.y + 6 }, [.26, .29, .28]); }
      ribbon(result.structures, a, b, -outer-.2, outer+.2, 5.7, [.25, .28, .27]);
      if (lod === 0) for (const [start, end] of dashSpans(s.station, length, edge.laneProfile?.direction || 1, 30, 3)) ribbon(result.windows, mixPoint(a, b, start / length), mixPoint(a, b, end / length), w - .4, w - .1, 5.6, [.7, .85, .85]);
    }
    if (edge.blocked && !edge.unloaded && s.index === 0 && (world.loadedTiles || (Math.abs(a.x) < 2490 && Math.abs(a.z) < 2490))) {
      const length = distance2(a, b), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
      for (let k = -Math.floor(w / 1.4); k <= Math.floor(w / 1.4); k++) box(result.structures, { x: a.x + nx * k * 1.4, y: a.y, z: a.z + nz * k * 1.4 }, 1.3, .9, 1.3, k % 2 ? [.8, .33, .12] : [.67, .68, .58]);
    }
    if (lod === 0 && !edge.tunnel && s.join?.side!==1) for (const d of periodicOffsets(s.station, distance2(a, b), edge.laneProfile?.direction || 1)) {
      const l = distance2(a, b), anchor = mixPoint(a, b, d / l), p = { x: anchor.x + (b.z - a.z) / l * (w + 1.6), y: anchor.y, z: anchor.z - (b.x - a.x) / l * (w + 1.6) };
      const free = segments.every(other => Math.abs(other.a.y-p.y)>3 || projectOnSegment(p,other.a,other.b).distance > other.edge.width/2+.6);
      if (free) { result.breakables.push({kind:'pole',point:p,heading:0}); result.lamps.push({ ...p, y: p.y + 6.7 }); }
    }
  }
  const models=worldLandmarks(world).filter(model=>model.key===key&&(lod===0||model.asset.far));
  for(const model of models)appendLandmark(result.landmarks!,model,lod);
  for (const building of index.buildings.get(key) || []) {
    if(models.some(model=>model.asset.kind==='building'&&model.asset.osm.some(ref=>ref.type===(building.osmType||'way')&&ref.id===building.id)))continue;
    const groundRing=(ring:Point[])=>ring.flatMap((p,i)=>{
      const q=ring[(i+1)%ring.length],cuts=new Set([0,1]);
      // Внутри треугольника земля линейна: минимумы на пересечениях
      // ребра дома с линиями сетки и диагоналями, в том числе в соседнем квартале.
      for(const [a,b] of [[p.x,q.x],[p.z,q.z],[p.x+p.z,q.x+q.z]])if(a!==b)
        for(let line=Math.ceil(Math.min(a,b)/12.5);line<=Math.floor(Math.max(a,b)/12.5);line++)cuts.add((line*12.5-a)/(b-a));
      return [...cuts].map(t=>{const v=mixPoint(p,q,t);return {...v,y:terrainHeight(v.x,v.z)};});
    });
    const foundationFloor=Math.min(...[building.footprint,...(building.holes||[])].flatMap(groundRing).map(p=>p.y));
    const groundVertex=(p:Point)=>({...p,y:terrainHeight(p.x,p.z)});
    const grounded={...building,footprint:building.footprint.map(groundVertex),holes:building.holes?.map(r=>r.map(groundVertex))};
    const roads=index.spatial.query(boundsOf(building.footprint)).filter(s=>!s.edge.tunnel&&!s.edge.bridge).map(s=>roadPrism(s.a,s.b,s.edge.width+.6,10000,s.edge.passage?5.5:4.5));
    appendBuilding(grounded,lod,result.buildings,result.facades!,roads,foundationFloor);
    for(const s of index.spatial.query(boundsOf(building.footprint)).filter(s=>s.edge.passage)){
      const length=distance2(s.a,s.b)||1,nx=(s.b.z-s.a.z)/length,nz=-(s.b.x-s.a.x)/length;
      for(const side of [-1,1]){
        const d=(s.edge.width+.6)/2,aa={...s.a,x:s.a.x+nx*d*side,z:s.a.z+nz*d*side},bb={...s.b,x:s.b.x+nx*d*side,z:s.b.z+nz*d*side};
        for(const [p,q] of segmentPolygonSpans(aa,bb,grounded.footprint,grounded.holes))quad(result.structures,{...p,y:p.y-.25},{...q,y:q.y-.25},{...q,y:q.y+5.5},{...p,y:p.y+5.5},[.4,.42,.4]);
      }
    }
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
    if(lod===0&&area.railing)for(const ring of [area.points])for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],length=distance2(a,b),parts=Math.max(1,Math.ceil(length/10));
      for(let j=0;j<parts;j++){
        const p=mixPoint(a,b,j/parts),q=mixPoint(a,b,(j+1)/parts),mid=mixPoint(p,q,.5);
        if(tileKey(mid.x,mid.z)!==key)continue;
        if(area.railing==='river'&&!segments.some(s=>/набережн/iu.test(s.edge.name)&&projectOnSegment(mid,s.a,s.b).distance<s.edge.width/2+24))continue;
        result.breakables.push({kind:'fence',point:mid,heading:Math.atan2(q.x-p.x,q.z-p.z),length:distance2(p,q)});
      }
    }
  }
  if (lod === 0) for (const tree of world.trees) if (tileKey(tree.x, tree.z) === key && segments.every(s => projectOnSegment(tree,s.a,s.b).distance > s.edge.width/2+2)) result.trees.push({ ...tree, y: ground(tree.x,tree.z) });
  if(lod===0)for(const tree of result.trees)box(result.treeTrunks,tree,.55,7,.55,[.23,.24,.2]);
  const roadCuts=new SpatialGrid<Prism>(32);
  for(const s of segments)if(!s.edge.bridge&&!s.edge.tunnel){
    const length=distance2(s.a,s.b)||1,aa=mixPoint(s.a,s.b,-.3/length),bb=mixPoint(s.a,s.b,1+.3/length);
    const cut=roadPrism(aa,bb,s.edge.width+14,10000,10000);roadCuts.add(cut,cut.bounds);
  }
  cutSoil(result.terrain,roadCuts);
  if(segments.some(s=>s.edge.tunnel||s.edge.tunnelApproach)){
    cutSoil(result.terrain,index.cavities);
    cutSoil(result.shoulders,index.cavities);
  }
  return result;
}
