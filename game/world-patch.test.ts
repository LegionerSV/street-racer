import { expect, it } from 'vitest';
import { buildWorld } from './network';
import type { RegionData } from './types';
import { applyWorldPatch, createWorldPatch } from './world-patch';

const region = (way: number, loadedTiles: string[]): RegionData => ({
  center: { lat: 0, lon: 0 },
  elements: [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 0, lon: 0.001 },
    { type: 'way', id: way, nodes: [1, 2], tags: { highway: 'residential' } },
  ],
  elevation: { width: 2, size: 1000, values: new Float32Array(4) },
  drivingSide: 'right',
  fetchedAt: 'test',
  loadedTiles,
  heightDatum: 0,
});

it('возвращает типизированные изменения и точные dirty chunks', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384'])),
    after = buildWorld(region(11, ['15/16384/16384', '15/16385/16384']));
  before.trees = [{ x: 1, y: 0, z: 1 }];
  after.trees = [{ x: 2, y: 0, z: 2 }];
  before.elevation.patches = [
    { width: 2, size: 1000, offsetX: -500, values: new Float32Array(4) },
  ];
  after.elevation.patches = [
    { width: 2, size: 1000, offsetX: 500, values: new Float32Array(4) },
  ];
  // Act
  const patch = createWorldPatch(before, after);
  // Assert
  expect(patch.coverageAdded).toEqual(['15/16385/16384']);
  expect(patch.edgesRemoved).toEqual(before.edges.map((edge) => edge.stableId));
  expect(patch.edgesAddedOrUpdated.map((edge) => edge.stableId)).toEqual(
    after.edges.map((edge) => edge.stableId),
  );
  expect(patch.dirtyChunks.length).toBeGreaterThan(0);
  expect(patch.dirtyChunks).not.toContain('20,20');
  expect(patch.treesRemoved).toEqual(before.trees);
  expect(patch.treesAdded).toEqual(after.trees);
  expect(patch.elevationPatchesRemoved).toEqual(['-500,0']);
});
it('не передаёт неизменную дорогу заново из-за диапазона исходных высот', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384']));
  before.edges = [{
    id: 1, stableId: '10/1/2/0', way: 10, from: 1, to: 2,
    length: 100, width: 8, lanes: 2, speed: 40, name: 'Тестовая улица',
    bridge: false, tunnel: false, layer: 0, blocked: false,
    points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }],
    sourceHeightRange: [0, 0],
  }];
  const after = structuredClone(before);
  expect(before.edges.length).toBeGreaterThan(0);
  for (const edge of after.edges) {
    edge.id += 100;
    edge.sourceHeightRange = [2, 3];
  }

  // Act
  const patch = createWorldPatch(before, after, ['0,0']);

  // Assert
  expect(patch.edgesAddedOrUpdated).toEqual([]);
  expect(patch.edgesRemoved).toEqual([]);
  expect(patch.dirtyChunks).toEqual([]);
});
it('не пересобирает пустой квартал при расширении покрытия соседним тайлом', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384']));
  const after = buildWorld(region(11, ['15/16384/16384', '15/16385/16384']));
  const installed = ['4,-5', '20,20'];
  // Act
  const patch = createWorldPatch(before, after, installed);
  // Assert
  expect(patch.dirtyChunks).not.toContain('4,-5');
  expect(patch.dirtyChunks.every((key) => installed.includes(key))).toBe(true);
});
it('не пересобирает квартал при появлении одинакового рельефа из соседнего большого DEM', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384']));
  before.elevation.patches = [
    { width: 2, size: 10400, offsetX: 0, values: new Float32Array(4) },
  ];
  const after = structuredClone(before);
  after.elevation.patches!.push({
    width: 2,
    size: 10400,
    offsetX: 700,
    values: new Float32Array(4),
  });

  // Act
  const patch = createWorldPatch(before, after, ['0,0']);

  // Assert
  expect(patch.dirtyChunks).toEqual([]);
  expect(patch.elevationPatches).toHaveLength(1);
});
it('пересобирает квартал, когда новый DEM действительно меняет его высоту', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384']));
  before.elevation.patches = [
    { width: 2, size: 10400, offsetX: 0, values: new Float32Array(4) },
  ];
  const after = structuredClone(before);
  after.elevation.patches!.push({
    width: 2,
    size: 10400,
    offsetX: 700,
    values: new Float32Array([8, 8, 8, 8]),
  });

  // Act
  const patch = createWorldPatch(before, after, ['0,0']);

  // Assert
  expect(patch.dirtyChunks).toContain('0,0');
});
it('восстанавливает новый мир из малого патча без полной копии', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384']));
  const after = buildWorld(region(11, ['15/16384/16384', '15/16385/16384']));
  after.trees = [{ x: 12, y: 0, z: 34 }];
  const patch = createWorldPatch(before, after, ['4,-5']);
  const meta = {
    center: after.center,
    drivingSide: after.drivingSide,
    heightDatum: after.heightDatum,
    warnings: after.warnings,
    spawnEdge: after.spawnEdge,
    routes: after.routes,
    elevation: { ...after.elevation, patches: undefined },
  };
  // Act
  const restored = applyWorldPatch(before, patch, meta);
  // Assert
  expect(restored.loadedTiles).toEqual(after.loadedTiles);
  expect(restored.edges.map((edge) => edge.stableId).sort((a, b) => a.localeCompare(b))).toEqual(
    after.edges.map((edge) => edge.stableId).sort((a, b) => a.localeCompare(b)),
  );
  expect(restored.nodes.map((node) => node.id).sort((a, b) => a - b)).toEqual(
    after.nodes.map((node) => node.id).sort((a, b) => a - b),
  );
  expect(restored.trees).toEqual(after.trees);
  expect(restored.routes).toEqual(after.routes);
});
it('не передаёт повторно дорогу при изменении только её служебного номера', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384']));
  before.edges = [{ id: 0, stableId: '10/1/2/0', way: 10, from: 1, to: 2, length: 100, width: 7, lanes: 2, speed: 14, name: 'Улица', bridge: false, tunnel: false, layer: 0, points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }], blocked: false }];
  const after = structuredClone(before);
  after.edges.forEach((edge) => (edge.id += 100));
  // Act
  const patch = createWorldPatch(before, after, ['4,-5']);
  // Assert
  expect(patch.edgesAddedOrUpdated).toEqual([]);
  expect(patch.edgesRemoved).toEqual([]);
});
it('инвалидирует только маршрут, ребро которого изменилось',()=>{
  // Arrange
  const before=buildWorld(region(10,['15/16384/16384']));
  before.edges=[{id:0,stableId:'10/1/2/0',way:10,from:1,to:2,length:100,width:7,lanes:2,speed:14,name:'Улица',bridge:false,tunnel:false,layer:0,points:[{x:0,y:0,z:0},{x:0,y:0,z:100}],blocked:false}];
  const after=structuredClone(before),edge=before.edges[0].stableId;
  const route=(id:string,edges:string[])=>({id,kind:'sprint' as const,title:id,edges,points:before.edges[0].points,cumulative:[0,before.edges[0].length],length:before.edges[0].length,laps:1});
  before.routes=[route('changed',[edge]),route('untouched',['unrelated'])];after.routes=structuredClone(before.routes);after.edges[0].speed++;
  // Act
  const patch=createWorldPatch(before,after);
  // Assert
  expect(patch.invalidatedRoutes).toContain('changed');expect(patch.invalidatedRoutes).not.toContain('untouched');
  const coverageBefore=structuredClone(before);delete coverageBefore.loadedTiles;
  const coverageAfter=structuredClone(coverageBefore);coverageAfter.loadedTiles=[];
  expect(createWorldPatch(coverageBefore,coverageAfter).invalidatedRoutes).toEqual(['changed','untouched']);
});
