import {expect,it} from 'vitest';
import {trajectoryConflict} from './traffic-conflicts';

it('предсказывает одновременное пересечение перпендикулярных траекторий',()=>{
  // Arrange
  const north={point:{x:0,y:0,z:-20},heading:0,speed:10};
  const east={point:{x:-20,y:0,z:0},heading:Math.PI/2,speed:10};
  // Act
  const conflict=trajectoryConflict(north,east);
  // Assert
  expect(conflict?.time).toBeCloseTo(2,6);
  expect(conflict?.distance).toBeCloseTo(20,6);
});

it('не блокирует потоки, проходящие через точку в разное время',()=>{
  // Arrange / Act / Assert
  expect(trajectoryConflict(
    {point:{x:0,y:0,z:-40},heading:0,speed:5},
    {point:{x:-10,y:0,z:0},heading:Math.PI/2,speed:20},
  )).toBeNull();
});
