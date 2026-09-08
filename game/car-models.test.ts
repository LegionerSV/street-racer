import { expect,it } from 'vitest';
import { NullEngine,Scene,VertexBuffer,Vector3,Ray,Mesh } from '@babylonjs/core';
import { createCar,createTrafficCar,type CarKind } from './visuals';
it.each(['sport','sedan','hatch','suv','van'] as CarKind[])('кузов %s закрыт снаружи, фары расположены перед ним',kind=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine),car=createCar(scene,'#447788',kind,kind);
  try{
    // Act — луч снаружи отбирает только лицевые стороны: тот же отсев, что при отрисовке.
    const paint=car.root.getChildMeshes().find(m=>m.name.includes('trim-')&&m.material?.name.endsWith('-paint'))! as Mesh;
    paint.computeWorldMatrix(true);
    const frontFace=(a:Vector3,b:Vector3,c:Vector3,ray:Ray)=>Vector3.Dot(Vector3.Cross(a.subtract(b),c.subtract(b)),ray.direction)<0;
    const front=new Ray(new Vector3(0,-.1,8),new Vector3(0,0,-1));
    const rear=new Ray(new Vector3(0,-.1,-8),new Vector3(0,0,1));
    const top=new Ray(new Vector3(0,4,-.3),new Vector3(0,-1,0));
    // Assert
    for(const ray of [front,rear,top])expect(paint.intersects(ray,false,frontFace).hit).toBe(true);
    expect(paint.intersects(front,false,frontFace).pickedPoint!.z).toBeGreaterThan(1.8);
    expect(paint.intersects(rear,false,frontFace).pickedPoint!.z).toBeLessThan(-1.8);
    expect(paint.intersects(top,false,frontFace).pickedPoint!.y).toBeGreaterThan(.7);
    expect(paint.material!.needAlphaBlendingForMesh(paint)).toBe(false);
    expect(paint.material!.disableDepthWrite).toBe(false);
    expect(paint.getVerticesData(VertexBuffer.NormalKind)!.every(Number.isFinite)).toBe(true);
    for(const lamp of car.lamps.filter(m=>m.name.includes('headlight'))){
      lamp.computeWorldMatrix(true);const pos=lamp.getAbsolutePosition();
      const hit=paint.intersects(new Ray(new Vector3(pos.x,pos.y,8),new Vector3(0,0,-1)),false);
      expect(hit.hit&&hit.pickedPoint!.z>pos.z).toBe(false);
    }
  }finally{car.dispose();scene.dispose();engine.dispose();}
});
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
