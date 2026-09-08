import { describe, it, expect } from 'vitest';
import { desiredChunks, criticalChunks, ChunkBudget, buildChunk } from './chunks';
import type { World } from './types';
import { polygonContains } from './geo';

describe('Подготовка кварталов', () => {
  it('ждёт только стартовую зону и путь на 70 м вперёд с запасом у границ',()=>{
    // Arrange / Act / Assert
    expect(criticalChunks({x:125,y:0,z:125},0)).toEqual(['0,0']);
    expect(new Set(criticalChunks({x:0,y:0,z:0},0))).toEqual(new Set(['-1,-1','-1,0','0,-1','0,0']));
    expect(new Set(criticalChunks({x:125,y:0,z:220},0))).toEqual(new Set(['0,0','0,1']));
    expect(criticalChunks({x:2490,y:0,z:2490},0)).toEqual(['9,9']);
  });
  it('тротуар не пересекает проезжую часть на перекрёстке',()=>{
    // Arrange
    const edge={id:0,way:1,from:1,to:2,length:100,width:7,lanes:2,speed:14,name:'Улица',bridge:false,tunnel:false,layer:0,points:[{x:100,y:0,z:20},{x:100,y:0,z:120}],blocked:false};
    const world={center:{lat:0,lon:0},nodes:[],edges:[edge,{...edge,id:1,way:2,from:3,to:4,points:[{x:50,y:0,z:70},{x:150,y:0,z:70}]}],restrictions:[],buildings:[],areas:[],trees:[],elevation:{width:2,size:5600,values:new Float32Array(4)},drivingSide:'right',warnings:[],spawnEdge:0,routes:[]} as World;
    // Act
    const mesh=buildChunk(world,'0,0',0).sidewalks!;
    // Assert
    for(let i=0;i<mesh.indices.length;i+=3){const points=mesh.indices.slice(i,i+3).map(j=>({x:mesh.positions[j*3],y:mesh.positions[j*3+1],z:mesh.positions[j*3+2]}));
      for(const p of [{x:104,y:0,z:70},{x:96,y:0,z:70},{x:100,y:0,z:74},{x:100,y:0,z:66}])expect(polygonContains(p,points)).toBe(false);
    }
  });
  it.each(['road','bridge','tunnel'])('строит тротуары шириной 2 м и поребрики высотой 15 см: %s',kind=>{
    // Arrange
    const world={center:{lat:0,lon:0},nodes:[],edges:[{id:0,way:1,from:1,to:2,length:100,width:7,lanes:2,speed:14,name:'Улица',bridge:kind==='bridge',tunnel:kind==='tunnel',layer:kind==='bridge'?1:0,points:[{x:100,y:1,z:20},{x:100,y:3,z:120}],blocked:false}],restrictions:[],buildings:[],areas:[],trees:[],elevation:{width:2,size:5600,values:new Float32Array(4)},drivingSide:'right',warnings:[],spawnEdge:0,routes:[]} as World;
    // Act
    const mesh=buildChunk(world,'0,0',0).sidewalks;
    // Assert
    expect(mesh?.indices.length).toBeGreaterThan(0);
    const positions=mesh!.positions,points=Array.from({length:positions.length/3},(_,i)=>positions.slice(i*3,i*3+3));
    for(const side of [-1,1])for(const offset of [3.5,3.7,5.7])expect(points.some(p=>Math.abs(p[0]-(100+side*offset))<1e-6)).toBe(true);
    for(const p of points)expect(p[1]-(1+(p[2]-20)*.02)).toBeLessThanOrEqual(.150001);
    expect(points.some(p=>Math.abs(p[1]-(1+(p[2]-20)*.02)-.15)<1e-6)).toBe(true);
  });
  it('сохраняет ограниченный набор кварталов при длительной езде', () => {
    // Arrange
    const budget = new ChunkBudget(64);
    // Act
    for (let i = 0; i < 1000; i++) budget.touch(String(i), i);
    // Assert
    expect(budget.size).toBe(64); expect(budget.has('999')).toBe(true); expect(budget.has('0')).toBe(false);
  });
  it('подготавливает квартал под машиной и не выходит за пределы мира', () => {
    // Arrange / Act
    const result = desiredChunks({ x: 2490, y: 0, z: 2490 }, 0, 'high');
    // Assert
    expect(result.find(c => c.key === '9,9')?.lod).toBe(0);
    expect(result.every(c => { const [x, z] = c.key.split(',').map(Number); return x >= -10 && x < 10 && z >= -10 && z < 10; })).toBe(true);
  });
  it('генерирует совпадающие высоты на соседних границах', () => {
    // Arrange
    const w = { center: { lat: 0, lon: 0 }, nodes: [], edges: [], restrictions: [], buildings: [], areas: [], trees: [], elevation: { width: 2, size: 5600, values: new Float32Array([0, 20, 40, 60]) }, drivingSide: 'right', warnings: [], spawnEdge: -1, routes: [] } as World;
    // Act
    const a = buildChunk(w, '0,0', 0), b = buildChunk(w, '1,0', 0);
    const border = (positions: number[]) => { const list = []; for (let i = 0; i < positions.length; i += 3) if (positions[i] === 250) list.push([positions[i + 2], positions[i + 1]]); return list.sort((a, b) => a[0] - b[0]); };
    // Assert
    expect(border(a.terrain.positions)).toEqual(border(b.terrain.positions));
  });
  it('не создаёт горизонтальные ступени на наклонном дорожном полотне', () => {
    // Arrange
    const points = Array.from({ length: 11 }, (_, i) => ({ x: 100, y: i + .12, z: i * 10 }));
    const w = { center: { lat: 0, lon: 0 }, nodes: [], edges: [{ id: 0, way: 1, from: 1, to: 2, length: 101, width: 7, lanes: 2, speed: 14, name: 'Подъём', bridge: false, tunnel: false, layer: 0, points, blocked: false }], restrictions: [], buildings: [], areas: [], trees: [], elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', warnings: [], spawnEdge: 0, routes: [] } as World;
    // Act
    const road = buildChunk(w, '0,0', 0).road;
    // Assert
    for (let i = 0; i < road.positions.length; i += 3) expect(Math.abs(road.positions[i + 1] - (.12 + road.positions[i + 2] * .1))).toBeLessThan(.1);
  });
});
