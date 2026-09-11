import { expect, it } from 'vitest';
import { buildWorld } from './network';
import type { RegionData } from './types';
import { createWorldPatch } from './world-patch';

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
