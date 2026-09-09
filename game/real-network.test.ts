import { describe, it, expect } from 'vitest';
import fixture from './fixtures/moscow-bridge.osm.json';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { tileKey } from './geo';
import type { OSMElement, RegionData } from './types';

describe('Реальный фрагмент Москвы', () => {
  it('строит дороги и мост из сохранённых координат OSM без сети', () => {
    // Arrange
    const region: RegionData = { center: { lat: 55.745, lon: 37.6135 }, elements: fixture.elements as OSMElement[], elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', fetchedAt: '2026-09-06' };
    // Act
    const world = buildWorld(region), bridge = world.edges.find(e => e.bridge && !e.blocked)!;
    const chunk = buildChunk(world, tileKey(bridge.points[0].x, bridge.points[0].z), 0);
    // Assert
    expect(world.edges.length).toBeGreaterThan(100); expect(bridge).toBeDefined();
    expect(chunk.road.positions.length).toBeGreaterThan(0); expect(chunk.structures.positions.length).toBeGreaterThan(0);
    expect(chunk.road.positions.every(Number.isFinite)).toBe(true);
  });
});

import riverFixture from './fixtures/moscow-river.osm.json';
import elevationFixture from './fixtures/moscow-elevation.json';
import { mixPoint, polygonContains, projectOnSegment } from './geo';

const terrainAt=(chunk:ReturnType<typeof buildChunk>,point:{x:number;z:number})=>{
  const heights:number[]=[];
  for(let i=0;i<chunk.terrain.indices.length;i+=3){
    const ids=chunk.terrain.indices.slice(i,i+3),triangle=ids.map(id=>({x:chunk.terrain.positions[id*3],y:chunk.terrain.positions[id*3+1],z:chunk.terrain.positions[id*3+2]}));
    if(!polygonContains({...point,y:0},triangle))continue;
    const [a,b,c]=triangle,den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(Math.abs(den)<1e-8)continue;
    const wa=((b.z-c.z)*(point.x-c.x)+(c.x-b.x)*(point.z-c.z))/den,wb=((c.z-a.z)*(point.x-c.x)+(a.x-c.x)*(point.z-c.z))/den;
    heights.push(wa*a.y+wb*b.y+(1-wa-wb)*c.y);
  }
  return heights;
};

it('асфальт на реальном рельефе у Москвы-реки остаётся выше треугольников земли', () => {
  // Arrange
  const merged = new Map([...fixture.elements, ...riverFixture.elements].map(e => [e.type + '/' + e.id, e]));
  const region: RegionData = { center: { lat: 55.745, lon: 37.6135 }, elements: [...merged.values()] as OSMElement[], elevation: { width: elevationFixture.width, size: elevationFixture.size, values: Float32Array.from(elevationFixture.values) }, drivingSide: 'right', fetchedAt: '2026-09-06' };
  const world = buildWorld(region), cache = new Map<string, ReturnType<typeof buildChunk>>();
  let checked = 0, waterChunks = 0;
  // Act / Assert
  for (const edge of world.edges) {
    if (edge.blocked || edge.bridge || edge.tunnel) continue;
    for (let i = 1; i < edge.points.length; i += 3) {
      const a = edge.points[i - 1], b = edge.points[i], p = mixPoint(a, b, .5), length = Math.hypot(b.x-a.x,b.z-a.z);
      p.x += (b.z-a.z) / length * edge.width * .35; p.z -= (b.x-a.x) / length * edge.width * .35;
      const key = tileKey(p.x, p.z); let chunk = cache.get(key);
      if (!chunk) { chunk = buildChunk(world, key, 0); cache.set(key, chunk); if (chunk.water.indices.length) waterChunks++; }
      const roadY = projectOnSegment(p,a,b).point.y;
      for(const terrainY of terrainAt(chunk,p))expect(terrainY, 'Полотно перекрыто землёй: ' + edge.name + ', ' + key).toBeLessThan(roadY - .1);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(100); expect(waterChunks).toBeGreaterThan(0);
}, 30000);
