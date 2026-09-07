import { expect,it } from 'vitest';
import { roadLayout, directedLanes, laneCaption } from './lanes';
import { buildWorld } from './network';
import hospital from './fixtures/pushkin-hospital.osm.json';
import type { OSMElement } from './types';
it('сохраняет асимметричные полосы и смещённую разделительную линию',()=>{
  // Arrange / Act
  const road=roadLayout({highway:'primary',lanes:'3','lanes:forward':'2','lanes:backward':'1','turn:lanes:forward':'left|through'});
  const forward=directedLanes(road,'right',1),backward=directedLanes(road,'right',-1);
  // Assert
  expect(forward.offsets).toHaveLength(2);expect(backward.offsets).toHaveLength(1);
  expect(forward.offsets[0]).toBeCloseTo(0);expect(forward.offsets[1]).toBeCloseTo(3.4);expect(backward.offsets[0]).toBeCloseTo(3.4);
  expect(forward.separators.find(s=>s.kind==='divider')?.offset).toBeCloseTo(-1.7);
  expect(forward.turns).toEqual([['left'],['through']]);
  expect(laneCaption({lanes:3,laneProfile:forward})).toBe('3 полосы · 2 в вашем направлении');
});
it('уважает обратное одностороннее движение и явное oneway=no',()=>{
  // Arrange / Act / Assert
  expect(roadLayout({highway:'motorway',oneway:'no',lanes:'4'}).oneWay).toBe(0);
  const r=roadLayout({highway:'primary',oneway:'-1',lanes:'2','turn:lanes:backward':'through|right'});
  expect(r.forward).toBe(0);expect(directedLanes(r,'right',-1).turns).toEqual([['through'],['right']]);
  expect(directedLanes(r,'right',-1).separators.every(s=>s.kind==='lane')).toBe(true);
});
it('отдельно хранит общую центральную полосу и узкий однополосный проезд',()=>{
  // Arrange / Act
  const r=roadLayout({highway:'residential',lanes:'3','lanes:both_ways':'1'});
  const narrow=roadLayout({highway:'service',lanes:'1',width:'3.5'});
  // Assert
  expect(r.forward).toBe(1);expect(r.backward).toBe(1);expect(r.bothWays).toBe(1);
  expect(directedLanes(r,'right',1).offsets[0]).toBeCloseTo(3.4);
  expect(narrow.shared).toBe(true);expect(directedLanes(narrow,'right',1).offsets).toEqual([0]);
});
it('на Госпитальном переулке сохраняет две встречные полосы и реальную длину около 946 м',()=>{
  // Arrange
  const world=buildWorld({center:{lat:59.7057,lon:30.3805},elements:hospital.elements as OSMElement[],drivingSide:'right',fetchedAt:'test',elevation:{width:2,size:5600,values:new Float32Array(4)}});
  // Act
  const forward=world.edges.filter(e=>e.laneProfile?.direction===1),length=forward.reduce((sum,e)=>sum+e.length,0);
  // Assert
  expect(length).toBeGreaterThan(943);expect(length).toBeLessThan(950);
  expect(world.edges.every(e=>e.lanes===2&&e.laneProfile?.offsets.length===1)).toBe(true);
  expect(world.edges.every(e=>e.laneProfile?.source==='osm')).toBe(true);
});

it('явные две полосы на дороге шириной 5 м сохраняют встречные траектории',()=>{
  // Arrange / Act
  const road=roadLayout({highway:'residential',lanes:'2',width:'5'});
  // Assert
  expect(road.shared).toBe(false);expect(directedLanes(road,'right',1).offsets).toEqual([1.25]);
});
it('нулевое число полос в направлении не превращается в дополнительную полосу',()=>{
  // Arrange / Act
  const tags={highway:'residential',lanes:'2','lanes:forward':'0','lanes:backward':'2'},road=roadLayout(tags);
  const world=buildWorld({center:{lat:0,lon:0},elements:[{type:'node',id:1,lat:0,lon:0},{type:'node',id:2,lat:.001,lon:0},{type:'way',id:10,nodes:[1,2],tags}],drivingSide:'right',fetchedAt:'test',elevation:{width:2,size:5600,values:new Float32Array(4)}});
  // Assert
  expect(road.total).toBe(2);expect(road.forward).toBe(0);expect(world.edges).toHaveLength(1);expect(world.edges[0].from).toBe(2);
});
it('встречная автобусная полоса сохраняет физическую ширину односторонней дороги',()=>{
  // Arrange / Act
  const road=roadLayout({highway:'primary',oneway:'yes',lanes:'3','lanes:forward':'2','lanes:backward':'1','oneway:bus':'no'});
  // Assert
  expect(road.total).toBe(3);expect(road.width).toBeCloseTo(10.2);expect(road.oneWay).toBe(1);expect(directedLanes(road,'right',1).offsets).toHaveLength(2);
});
