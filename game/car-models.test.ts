import { expect,it } from 'vitest';
import { NullEngine,Scene } from '@babylonjs/core';
import { createCar,createTrafficCar,type CarKind } from './visuals';
it('пять типов кузова имеют разные пропорции и реальные размеры в метрах',()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine),kinds:CarKind[]=['sport','sedan','hatch','suv','van'];
  const cars=kinds.map(kind=>createCar(scene,'#447788',kind,kind));
  try{
    // Act
    const sizes=cars.map(car=>{const b=car.root.getHierarchyBoundingVectors(true);return b.max.subtract(b.min);});
    // Assert
    expect(new Set(sizes.map(s=>s.y.toFixed(2)))).toHaveLength(5);
    for(const s of sizes){expect(s.x).toBeGreaterThan(1.7);expect(s.x).toBeLessThan(2.3);expect(s.z).toBeGreaterThan(3.7);expect(s.z).toBeLessThan(5.4);}
    expect(sizes[0].y).toBeLessThan(sizes[1].y);expect(sizes[2].z).toBeLessThan(sizes[1].z);expect(sizes[4].y).toBeGreaterThan(sizes[3].y);
  }finally{cars.forEach(c=>c.dispose());scene.dispose();engine.dispose();}
});
it('разные кузова одного цвета не подменяются общим прототипом, одинаковые используют его повторно',()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine);
  const sedan=createTrafficCar(scene,'#447788','sedan','sedan'),van=createTrafficCar(scene,'#447788','van','van');
  const count=scene.materials.length;
  // Act
  const another=createTrafficCar(scene,'#447788','van-2','van');
  // Assert
  try{expect(scene.materials.length).toBe(count);expect(van.root.getHierarchyBoundingVectors(true).max.y).toBeGreaterThan(sedan.root.getHierarchyBoundingVectors(true).max.y+.4);expect(another.wheels).toHaveLength(4);}
  finally{sedan.dispose();van.dispose();another.dispose();scene.dispose();engine.dispose();}
});
