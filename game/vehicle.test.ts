import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, Vector3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { PlayerCar } from './vehicle';

describe('Физическая машина', () => {
  it('нитро даёт заметный дополнительный разгон за три секунды на скорости 72 км/ч', async()=>{
    // Arrange
    const havok=await HavokPhysics({wasmBinary:Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url))).buffer});
    const engine=new NullEngine(),scene=new Scene(engine);
    scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
    const floor=MeshBuilder.CreateGround('floor',{width:1000,height:1000},scene);
    const ground=new PhysicsAggregate(floor,PhysicsShapeType.MESH,{mass:0,friction:.7},scene);
    const normal=new PlayerCar(scene),boosted=new PlayerCar(scene);
    normal.teleport({x:-10,y:.9,z:0},0);boosted.teleport({x:10,y:.9,z:0},0);
    try{
      for(let i=0;i<180;i++){for(const car of [normal,boosted])car.step(1/60,new Set(),false);scene.getPhysicsEngine()!._step(1/60);for(const car of [normal,boosted])car.afterPhysics();}
      normal.aggregate.body.setLinearVelocity(new Vector3(0,0,20));boosted.aggregate.body.setLinearVelocity(new Vector3(0,0,20));
      // Act
      for(let i=0;i<180;i++){normal.step(1/60,new Set(['KeyW']),false);boosted.step(1/60,new Set(['KeyW','ShiftLeft']),false);scene.getPhysicsEngine()!._step(1/60);normal.afterPhysics();boosted.afterPhysics();}
      // Assert
      expect(boosted.speed-normal.speed).toBeGreaterThan(13);
      expect(boosted.speed-normal.speed).toBeLessThan(16);
      expect(boosted.grounded).toBe(true);
      expect(boosted.nitro.charge).toBeCloseTo(1/3,1);
    }finally{normal.dispose();boosted.dispose();ground.dispose();scene.dispose();engine.dispose();}
  },20000);
  it('держится на подвеске, разгоняется и тормозит на настоящем Havok', async () => {
    // Arrange
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
    const engine = new NullEngine(), scene = new Scene(engine);
    scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    const floor = MeshBuilder.CreateGround('floor', { width: 5000, height: 5000 }, scene);
    const ground = new PhysicsAggregate(floor, PhysicsShapeType.MESH, { mass: 0, friction: .7 }, scene);
    const car = new PlayerCar(scene); car.teleport({ x: 0, y: .9, z: 0 }, 0);
    const step = (keys: Set<string>, count: number) => { for (let i = 0; i < count; i++) { car.step(1 / 60, keys, false); scene.getPhysicsEngine()!._step(1 / 60); car.afterPhysics(); } };
    try {
      // Act
      step(new Set(), 180);
      // Assert
      expect(car.position.y).toBeGreaterThan(.5); expect(car.position.y).toBeLessThan(1.3); expect(car.grounded).toBe(true);
      // Act
      step(new Set(['KeyW']), 600); const fast = car.speed;
      // Assert
      expect(fast).toBeGreaterThan(20); expect(car.position.z).toBeGreaterThan(100);
      // Act
      step(new Set(['KeyS']), 120);
      // Assert
      expect(car.speed).toBeLessThan(fast - 8); expect(car.position.y).toBeGreaterThan(.4);
    } finally { car.dispose(); ground.dispose(); scene.dispose(); engine.dispose(); }
  }, 20000);
});
