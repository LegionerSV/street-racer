import { expect, it } from 'vitest';
import { dashSpans } from './markings';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
it('длина штрихов остаётся три метра при любых узлах и границах кварталов',()=>{
  // Arrange
  const starts=[0,7,11,249,251,270], end=300;
  // Act
  const segmented=starts.flatMap((s,i)=>dashSpans(s,(starts[i+1]??end)-s).map(([a,b])=>[a+s,b+s]));
  const whole=dashSpans(0,end);
  // Assert
  expect(segmented.reduce((sum,[a,b])=>sum+b-a,0)).toBeCloseTo(whole.reduce((sum,[a,b])=>sum+b-a,0));
  for(let x=0;x<300;x+=.25)expect(segmented.some(([a,b])=>x>=a&&x<b)).toBe(whole.some(([a,b])=>x>=a&&x<b));
  expect(whole.every(([a,b])=>b-a===3)).toBe(true);
});
it('обратное направление сохраняет ту же фазу разметки',()=>{
  // Arrange / Act
  const forward=dashSpans(7,20),reverse=dashSpans(27,20,-1).map(([a,b])=>[20-b,20-a]).reverse();
  // Assert
  expect(reverse).toEqual(forward);
});
it('односторонняя однополосная дорога не получает ложную осевую линию',()=>{
  // Arrange
  const world=buildWorld({center:{lat:0,lon:0},elements:[{type:'node',id:1,lat:0,lon:0},{type:'node',id:2,lat:.001,lon:0},{type:'way',id:10,nodes:[1,2],tags:{highway:'residential',oneway:'yes',lanes:'1'}}],drivingSide:'right',fetchedAt:'test',elevation:{width:2,size:5600,values:new Float32Array(4)}});
  // Act
  const mesh=buildChunk(world,'0,0',0).markings;
  // Assert
  expect(mesh.positions.length).toBeGreaterThan(0);
  expect(mesh.positions.filter((_,i)=>i%3===0).every(x=>Math.abs(x)>1)).toBe(true);
});
