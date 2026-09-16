import {expect,it} from 'vitest';
import {buildWorld} from './network';
import {signalApproaches} from './signal-approaches';
import type {OSMElement,RegionData} from './types';

const region=(direction?:string):RegionData=>{
  const nodes=[[-1,0],[0,0],[1,0],[0,-1],[0,1]].map(([lon,lat],index)=>({type:'node' as const,id:index+1,lon:lon*.001,lat:lat*.001,...(index===1?{tags:{highway:'traffic_signals',...(direction?{'traffic_signals:direction':direction}:{})}}:{})}));
  const ways:OSMElement[]=[{type:'way',id:10,nodes:[1,2,3],tags:{highway:'primary',lanes:'2'}},{type:'way',id:11,nodes:[4,2,5],tags:{highway:'primary',lanes:'2'}}];
  return {center:{lat:0,lon:0},elements:[...nodes,...ways],elevation:{width:2,size:5600,values:new Float32Array(4)},drivingSide:'right',fetchedAt:'test'};
};

it('вычисляет отдельную ориентированную головку для каждого входящего подхода',()=>{
  // Arrange / Act
  const approaches=signalApproaches(buildWorld(region()),2);
  // Assert
  expect(approaches).toHaveLength(4);
  expect(approaches.filter(approach=>approach.axis===0)).toHaveLength(2);
  expect(approaches.filter(approach=>approach.axis===1)).toHaveLength(2);
  expect(new Set(approaches.map(approach=>approach.heading.toFixed(2))).size).toBe(4);
});

it('учитывает traffic_signals:direction для направленного узла',()=>{
  // Arrange / Act
  const approaches=signalApproaches(buildWorld(region('forward')),2);
  // Assert
  expect(approaches).toHaveLength(2);
});
