import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { toLocal, distance2, projectOnSegment } from './geo';
import type { OSMElement, RegionData } from './types';
const region=(elements:OSMElement[]):RegionData=>({center:{lat:0,lon:0},elements,elevation:{width:2,size:5600,values:new Float32Array(4)},fetchedAt:'test',drivingSide:'right'});
it('сохраняет метрический масштаб улиц в Москве и Петербурге',()=>{
  // Arrange / Act — независимая формула большой окружности.
  for(const center of [{lat:55.75,lon:37.6},{lat:59.93,lon:30.3}]){
    const lat=center.lat+.006,lon=center.lon+.014,rad=Math.PI/180;
    const h=Math.sin((lat-center.lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(center.lat*rad)*Math.sin((lon-center.lon)*rad/2)**2;
    const meters=6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)),local=toLocal(lat,lon,center);
    // Assert
    expect(Math.abs(distance2({x:0,y:0,z:0},local)/meters-1)).toBeLessThan(.005);
  }
});
it('фонари не оказываются на поперечной улице',()=>{
  // Arrange
  const nodes:OSMElement[]=[[1,0,0],[2,.002,0],[3,0,-.001],[4,0,.001]].map(([id,lon,lat])=>({type:'node',id,lon,lat}));
  const w=buildWorld(region([...nodes,{type:'way',id:10,nodes:[1,2],tags:{highway:'primary'}},{type:'way',id:20,nodes:[3,1,4],tags:{highway:'primary',width:'18'}}]));
  // Act
  const chunks=['-1,-1','-1,0','0,-1','0,0'].map(k=>buildChunk(w,k,0));
  // Assert
  for(const lamp of chunks.flatMap(c=>c.lamps))for(const e of w.edges)for(let i=1;i<e.points.length;i++)expect(projectOnSegment(lamp,e.points[i-1],e.points[i]).distance).toBeGreaterThan(e.width/2+.4);
});
it('надземный проезд под зданием сохраняет уровень дороги и свободные пять метров',()=>{
  // Arrange
  const nodes:OSMElement[]=[[1,-.001,0],[2,.001,0],[3,-.0002,-.0002],[4,.0002,-.0002],[5,.0002,.0002],[6,-.0002,.0002]].map(([id,lon,lat])=>({type:'node',id,lon,lat}));
  const w=buildWorld(region([...nodes,{type:'way',id:10,nodes:[1,2],tags:{highway:'service',tunnel:'building_passage'}},{type:'way',id:20,nodes:[3,4,5,6,3],tags:{'building:part':'yes',height:'20',min_height:'6'}}]));
  // Act / Assert
  expect(w.edges[0].tunnel).toBe(false);expect(Math.min(...w.edges[0].points.map(p=>p.y))).toBeGreaterThan(-.1);
  expect(w.buildings[0].minHeight).toBe(6);
});

it('обратный обход контура не прячет окна в стену, а дальний квартал сохраняет их',()=>{
  // Arrange
  const outline=[{x:20,y:0,z:20},{x:70,y:0,z:20},{x:70,y:0,z:70},{x:20,y:0,z:70}];
  for(const footprint of [outline,[...outline].reverse()]){
    const w=buildWorld(region([]));w.buildings=[{id:200,footprint,height:20,colour:.5,roof:'flat'}];
    // Act
    const close=buildChunk(w,'0,0',0),far=buildChunk(w,'0,0',1);
    // Assert
    expect(close.windows.positions.length).toBeGreaterThan(0);expect(far.windows.positions).toEqual(close.windows.positions);
    for(let i=0;i<close.windows.positions.length;i+=3){const x=close.windows.positions[i],z=close.windows.positions[i+2];expect(x<20||x>70||z<20||z>70).toBe(true);}
  }
});
it('не оставляет узкую стену поперёк дороги между её узлами',()=>{
  // Arrange
  const data:OSMElement[]=[[1,0,0],[2,.0001,0],[3,.00002,-.0005],[4,.00003,-.0005],[5,.00003,.0005],[6,.00002,.0005]].map(([id,lon,lat])=>({type:'node',id,lon,lat}));
  data.push({type:'way',id:10,nodes:[1,2],tags:{highway:'service'}},{type:'way',id:20,nodes:[3,4,5,6,3],tags:{building:'yes'}});
  // Act
  const w=buildWorld(region(data));
  // Assert
  expect(w.buildings).toHaveLength(0);
});
