import {expect,it} from 'vitest';
import {buildWorld} from './network';
import {drivingEdgeAt} from './road-position';
it('определяет направление на длинной улице для полосности и восстановления',()=>{
  // Arrange
  const world=buildWorld({center:{lat:0,lon:0},elements:[{type:'node',id:1,lat:0,lon:0},{type:'node',id:2,lat:.009,lon:0},{type:'way',id:10,nodes:[1,2],tags:{highway:'primary',lanes:'3','lanes:forward':'2','lanes:backward':'1'}}],drivingSide:'right',fetchedAt:'test',elevation:{width:2,size:5600,values:new Float32Array(4)}});
  // Act / Assert
  expect(drivingEdgeAt(world,{x:2,y:1,z:850},0)?.laneProfile?.offsets).toHaveLength(2);
  expect(drivingEdgeAt(world,{x:-3,y:1,z:850},Math.PI)?.laneProfile?.offsets).toHaveLength(1);
  expect(drivingEdgeAt(world,{x:2,y:20,z:850},0)).toBeUndefined();
});
