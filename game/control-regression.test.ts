import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { PlayerCar } from './vehicle';
async function fixture(){
  const havok=await HavokPhysics({wasmBinary:Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url))).buffer});
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  const floor=new PhysicsAggregate(MeshBuilder.CreateGround('road',{width:5000,height:5000},scene),PhysicsShapeType.MESH,{mass:0},scene),car=new PlayerCar(scene);
  const step=(keys:string[],n:number)=>{for(let i=0;i<n;i++){car.step(1/60,new Set(keys),false);scene.getPhysicsEngine()!._step(1/60);car.afterPhysics();}};
  car.teleport({x:0,y:.9,z:0},0);step(['KeyW'],120);
  return {scene,engine,car,step,dispose:()=>{car.dispose();floor.dispose();scene.dispose();engine.dispose();}};
}
it.each([[20,0],[35,0],[25,1]])('обычный поворот при %s м/с и влажности %s не вызывает постоянный занос',async(speed,wetness)=>{
  // Arrange
  const f=await fixture();f.car.wetness=wetness;f.car.aggregate.body.setLinearVelocity(new Vector3(0,0,speed));
  let maxSlip=0,maxYaw=0;
  try{
    // Act
    for(let i=0;i<120;i++){f.step(['KeyW','KeyD'],1);if(i>20)maxSlip=Math.max(maxSlip,Math.abs(f.car.slip));maxYaw=Math.max(maxYaw,Math.abs(f.car.aggregate.body.getAngularVelocity().y));}
    const turned=f.car.heading;f.step([],90);
    // Assert
    expect(maxSlip).toBeLessThan(.2);expect(maxYaw).toBeLessThan(.85);expect(turned).toBeGreaterThan(.15);
    expect(Math.abs(f.car.slip)).toBeLessThan(.09);expect(Math.abs(f.car.aggregate.body.getAngularVelocity().y)).toBeLessThan(.12);
  }finally{f.dispose();}
},20000);
it.each([30,60,120])('100 метров при 36 км/ч занимают 10 секунд симуляции с частотой кадров %s',async fps=>{
  // Arrange — запускаем тот же накопитель фиксированного шага, что использует Scene.render.
  const f=await fixture(),physics=f.scene.getPhysicsEngine()!;physics.setSubTimeStep(1000/60);
  f.car.teleport({x:0,y:.9,z:0},0);f.step([],1);f.car.aggregate.body.setGravityFactor(0);f.car.aggregate.body.setLinearDamping(0);f.car.aggregate.body.setLinearVelocity(new Vector3(0,0,10));
  const start=f.car.position.z;let steps=0;f.scene.onBeforePhysicsObservable.add(()=>steps++);
  try{
    // Act
    for(let i=0;i<fps*10;i++)(f.scene as unknown as {_advancePhysicsEngineStep:(milliseconds:number)=>void})._advancePhysicsEngineStep(1000/fps);
    // Assert
    expect(f.car.position.z-start).toBeCloseTo(100,0);expect(steps).toBeGreaterThanOrEqual(599);expect(steps).toBeLessThanOrEqual(600);
  }finally{f.dispose();}
},20000);

it.each([-1,1])('при движении назад стабилизатор гасит боковое скольжение %s м/с',async side=>{
  // Arrange
  const f=await fixture();f.car.aggregate.body.setLinearVelocity(new Vector3(side,0,-8));f.car.aggregate.body.setAngularVelocity(Vector3.Zero());
  try{
    // Act
    let peakSlip=0;
    for(let i=0;i<60;i++){f.step([],1);peakSlip=Math.max(peakSlip,Math.abs(f.car.slip));}
    const lateral=Vector3.Dot(f.car.aggregate.body.getLinearVelocity(),f.car.visual.root.getDirection(Vector3.Right()));
    // Assert
    expect(peakSlip).toBeLessThan(Math.atan2(1,8)+.03);expect(Math.abs(lateral)).toBeLessThan(.2);expect(f.car.speed).toBeLessThan(-1);
    expect(Math.abs(f.car.slip)).toBeLessThan(.04);expect(Math.abs(f.car.aggregate.body.getAngularVelocity().y)).toBeLessThan(.1);
  }finally{f.dispose();}
},20000);
it('мокрое покрытие увеличивает настоящий тормозной путь без самопроизвольного разворота',async()=>{
  // Arrange
  const distances:number[]=[];
  for(const wetness of [0,1]){
    const f=await fixture();f.car.wetness=wetness;f.car.aggregate.body.setLinearVelocity(new Vector3(0,0,20));f.car.aggregate.body.setAngularVelocity(Vector3.Zero());
    const start=f.car.position.z;
    try{
      // Act
      for(let i=0;i<600;i++){f.step(['KeyS'],1);if(f.car.speed<.5)break;}
      distances.push(f.car.position.z-start);
      // Assert
      expect(Math.abs(f.car.heading)).toBeLessThan(.03);expect(f.car.speed).toBeLessThan(.5);
    }finally{f.dispose();}
  }
  expect(distances[1]).toBeGreaterThan(distances[0]*1.2);
},20000);

it.each([60,80,100,120].flatMap(kmh=>[-1,1].map(side=>[kmh,side])))('после %s км/ч полный руль в сторону %s заметно меняет траекторию',async(kmh,side)=>{
  // Arrange
  const f=await fixture(),speed=kmh/3.6,start=f.car.position.clone(),key=side>0?'KeyD':'KeyA';
  f.car.aggregate.body.setLinearVelocity(new Vector3(0,0,speed));f.car.aggregate.body.setAngularVelocity(Vector3.Zero());
  const minHeading:Record<number,number>={60:.8,80:.58,100:.46,120:.36};
  let distance=0,maxSlip=0,previous=start;
  try{
    // Act — держим заданную скорость педалью, не подменяя движение физического тела.
    for(let i=0;i<90;i++){
      f.step(f.car.groundSpeed<speed?['KeyW',key]:[key],1);
      distance+=Vector3.Distance(previous,f.car.position);previous=f.car.position.clone();maxSlip=Math.max(maxSlip,Math.abs(f.car.slip));
    }
    const heading=f.car.heading*side,radius=distance/heading,kmhActual=f.car.groundSpeed*3.6;
    // Assert
    expect(heading,`Радиус начального поворота: ${radius.toFixed(1)} м`).toBeGreaterThan(minHeading[kmh]);expect((f.car.position.x-start.x)*side).toBeGreaterThan(5);
    expect(kmhActual).toBeGreaterThan(kmh*.94);expect(maxSlip).toBeLessThan(.15);
    f.step([],90);expect(Math.abs(f.car.slip)).toBeLessThan(.09);expect(Math.abs(f.car.aggregate.body.getAngularVelocity().y)).toBeLessThan(.12);
  }finally{f.dispose();}
},20000);

it('затяжной поворот после 60 км/ч не опрокидывает машину и не превращается в постоянный занос',async()=>{
  // Arrange
  const f=await fixture(),speed=60/3.6;f.car.aggregate.body.setLinearVelocity(new Vector3(0,0,speed));
  let grounded=0,minUp=1,maxSlip=0;
  try{
    // Act
    for(let i=0;i<360;i++){
      f.step(f.car.groundSpeed<speed?['KeyW','KeyD']:['KeyD'],1);
      if(f.car.grounded)grounded++;
      minUp=Math.min(minUp,f.car.visual.root.getDirection(Vector3.Up()).y);
      maxSlip=Math.max(maxSlip,Math.abs(f.car.slip));
    }
    // Assert
    expect(grounded).toBeGreaterThan(350);expect(minUp).toBeGreaterThan(.85);expect(maxSlip).toBeLessThan(.15);
  }finally{f.dispose();}
},20000);

it('нитро даёт дополнительный разгон и не расходуется при торможении',async()=>{
  // Arrange
  const run=async(boost:boolean)=>{
    const f=await fixture();f.car.aggregate.body.setLinearVelocity(new Vector3(0,0,20));
    try{
      // Act
      f.step(boost?['ShiftLeft']:['KeyW'],120);
      const result={speed:f.car.groundSpeed,charge:f.car.nitro.charge};
      const before=f.car.nitro.charge;f.step(['KeyS','ShiftLeft'],30);
      // Assert
      expect(f.car.nitro.active).toBe(false);expect(f.car.nitro.charge).toBeGreaterThanOrEqual(before);
      return result;
    }finally{f.dispose();}
  };
  const normal=await run(false),boost=await run(true);
  expect(boost.speed).toBeGreaterThan(normal.speed+5);expect(boost.charge).toBeLessThan(.65);expect(normal.charge).toBe(1);
},20000);
