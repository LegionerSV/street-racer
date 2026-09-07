import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { PlayerCar } from './vehicle';

it('ручник блокирует заднюю ось, вызывает занос и подвеска не дрожит на ровной дороге', async () => {
  // Arrange
  const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0,-9.81,0), new HavokPlugin(true,havok));
  const floor = new PhysicsAggregate(MeshBuilder.CreateGround('test-floor',{width:5000,height:5000},scene),PhysicsShapeType.MESH,{mass:0},scene);
  const car = new PlayerCar(scene);
  const step = (keys: string[], count: number) => { for(let i=0;i<count;i++) {car.step(1/60,new Set(keys),false);scene.getPhysicsEngine()!._step(1/60);car.afterPhysics();}};
  try {
    car.teleport({x:0,y:.9,z:0},0); step([],180); step(['KeyW'],240);
    const heights:number[]=[];
    for(let i=0;i<120;i++){step(['KeyW'],1);heights.push(car.position.y);}
    expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(.045);
    // Act — одинаковый старт и скорость, сравниваем обычный поворот и ручник.
    const run = (handbrake:boolean) => {
      car.teleport({x:0,y:.9,z:0},0);step(['KeyW'],120);
      car.aggregate.body.setLinearVelocity(new Vector3(0,0,22));
      step(handbrake ? ['KeyD','Space'] : ['KeyD'],60);
      const v=car.aggregate.body.getLinearVelocity(), f=car.visual.root.getDirection(Vector3.Forward());
      return {speed:v.length(),slip:Math.abs(Math.atan2(v.x,v.z)-Math.atan2(f.x,f.z))};
    };
    const normal=run(false), drift=run(true);
    // Assert
    expect(drift.speed).toBeLessThan(normal.speed-2);
    expect(drift.slip).toBeGreaterThan(normal.slip+.1);
  } finally {car.dispose();floor.dispose();scene.dispose();engine.dispose();}
},20000);
