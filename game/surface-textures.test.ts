import { expect,it } from 'vitest';
import { asphaltSurface } from './surface-textures';

it('ограничивает отражающую маску сухого асфальта диапазоном 0–20',()=>{
  // Arrange / Act
  const {specular}=asphaltSurface(64);
  const values=Array.from(specular).filter((_,index)=>index%4!==3);
  // Assert
  expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...values)).toBeLessThanOrEqual(20);
});
