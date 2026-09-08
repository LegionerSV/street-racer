import { expect, it, vi } from 'vitest';
// NullEngine не создаёт GPU cubemap; этот тест проверяет жизненный цикл, не качество изображения.
vi.mock('./visuals', async original => ({ ...await original<typeof import('./visuals')>(), makeEnvironment: () => null }));
import { NullEngine, Scene, Vector3, Mesh, VertexData, PhysicsAggregate, PhysicsShapeType, HavokPlugin, MeshBuilder, FreeCamera } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { PlayerCar } from './vehicle';
import { Atmosphere } from './atmosphere';
import { material, createCar, setCarLights } from './visuals';
const physics=async()=>HavokPhysics({wasmBinary:Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url))).buffer});
it.each([0,.06])('машина возвращается с травы через обочину на поперечном склоне %s',async grade=>{
  // Arrange
  const world=buildWorld({center:{lat:0,lon:0},elements:[{type:'node',id:1,lat:-.002,lon:0},{type:'node',id:2,lat:.002,lon:0},{type:'way',id:10,nodes:[1,2],tags:{highway:'residential',width:'7'}}],elevation:{width:2,size:5600,values:Float32Array.from([-2800*grade,2800*grade,-2800*grade,2800*grade])},drivingSide:'right',fetchedAt:'test'});
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,await physics()));
  for(const key of ['-1,-1','-1,0','0,-1','0,0']){
    const c=buildChunk(world,key,0);
    for(const role of ['terrain','shoulders','road'] as const){const data=c[role];if(!data.indices.length)continue;const mesh=new Mesh(role,scene),v=new VertexData();v.positions=data.positions;v.indices=data.indices;v.applyToMesh(mesh);new PhysicsAggregate(mesh,PhysicsShapeType.MESH,{mass:0,friction:.6},scene);}
  }
  const car=new PlayerCar(scene);car.teleport({x:-15,y:1,z:0},Math.PI/2);
  try{
    // Act
    for(let i=0;i<900&&car.position.x<1;i++){car.step(1/60,new Set(car.speed<7?['KeyW']:[]),false);scene.getPhysicsEngine()!._step(1/60);car.afterPhysics();}
    // Assert
    expect(car.position.x).toBeGreaterThan(0);expect(car.position.y).toBeGreaterThan(.5);expect(car.grounded).toBe(true);
  }finally{car.dispose();scene.dispose();engine.dispose();}
},20000);
it('удар передаёт скорость другой машине, не превращая её в неподвижную стену',async()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,await physics()));
  const floor=new PhysicsAggregate(MeshBuilder.CreateGround('floor',{width:1000,height:1000},scene),PhysicsShapeType.MESH,{mass:0},scene);
  const car=new PlayerCar(scene),targetMesh=MeshBuilder.CreateBox('target',{width:1.84,height:.55,depth:4.3},scene);targetMesh.position.set(.9,.84,25);
  const target=new PhysicsAggregate(targetMesh,PhysicsShapeType.BOX,{mass:1200,restitution:.25,friction:.2},scene);
  target.body.setGravityFactor(0);
  car.teleport({x:0,y:.9,z:0},0);let transferred=0,yaw=0;
  try{
    // Act
    for(let i=0;i<240;i++){car.step(1/60,new Set(['KeyW']),false);scene.getPhysicsEngine()!._step(1/60);car.afterPhysics();transferred=Math.max(transferred,target.body.getLinearVelocity().z);yaw=Math.max(yaw,Math.abs(car.aggregate.body.getAngularVelocity().y));}
    // Assert
    expect(transferred).toBeGreaterThan(3);expect(yaw).toBeGreaterThan(.08);
  }finally{car.dispose();target.dispose();floor.dispose();scene.dispose();engine.dispose();}
},20000);
it('модель симметрична, колёса вращаются вокруг своей оси, стоп-сигналы и поворотники переключаются отдельно',()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine),car=createCar(scene,'#268fba','test');
  try{
    const bounds=car.root.getHierarchyBoundingVectors(true);
    expect(Math.abs(bounds.min.x+bounds.max.x)).toBeLessThan(.01);
    const wheel=car.wheels[0],rim=wheel.getChildMeshes().find(m=>m.name.includes('wheel-alloy'))!;
    rim.computeWorldMatrix(true);const before=rim.getBoundingInfo().boundingBox.centerWorld.clone();
    // Act
    rim.rotation.x+=1;rim.computeWorldMatrix(true);setCarLights(car,true,-1,.2);
    // Assert
    expect(Vector3.Distance(before,rim.getBoundingInfo().boundingBox.centerWorld)).toBeLessThan(.02);
    expect(car.brakeLights.every(m=>m.isVisible)).toBe(true);expect(car.indicators[0].every(m=>m.isVisible)).toBe(true);expect(car.indicators[1].every(m=>!m.isVisible)).toBe(true);
    setCarLights(car,false,-1,.6);expect(car.brakeLights.every(m=>!m.isVisible)).toBe(true);expect(car.indicators.flat().every(m=>!m.isVisible)).toBe(true);
  }finally{car.dispose();scene.dispose();engine.dispose();}
});
it('освещение и дождь создаются и освобождаются вместе со сценой',()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,3,-8),scene);
  const materials=Object.fromEntries(['road','water','windows'].map(key=>[key,material(scene,key,'#ffffff')]));
  const system=new Atmosphere(scene,camera,materials,'low');
  try{
    // Act
    system.update(0,1/60,Vector3.Zero(),{hour:12,weather:'rain'},'low');scene.render();
    // Assert
    expect(system.state.rain).toBe(1);expect(system.state.daylight).toBe(1);expect(scene.getMeshByName('rain')!.isEnabled()).toBe(true);
    system.update(0,1/60,Vector3.Zero(),{hour:0,weather:'clear'},'low');scene.render();expect(scene.getMeshByName('rain')!.isEnabled()).toBe(false);
  }finally{system.dispose();scene.dispose();engine.dispose();}
});

it('мобильное качество освобождает солнечные тени и сокращает дождь, сохраняя возможность теней фар',()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,3,-8),scene);
  const materials=Object.fromEntries(['road','water','windows'].map(key=>[key,material(scene,key,'#ffffff')]));
  const system=new Atmosphere(scene,camera,materials,'high');
  try{
    // Act
    system.update(0,1/30,Vector3.Zero(),{hour:12,weather:'rain'},'mobile');scene.render();
    // Assert
    expect(scene.shadowsEnabled).toBe(true);expect(scene.getLightByName('sun')!.getShadowGenerator()).toBeNull();expect(scene.getMeshByName('rain')!.getTotalVertices()).toBe(192);expect(system.state.wetness).toBe(1);
    system.update(0,1/30,Vector3.Zero(),{hour:12,weather:'clear'},'high');expect(scene.shadowsEnabled).toBe(true);
    system.update(0,1/30,Vector3.Zero(),{hour:12,weather:'rain'},'mobile');expect(scene.shadowsEnabled).toBe(true);expect(scene.getLightByName('sun')!.getShadowGenerator()).toBeNull();expect(scene.getMeshByName('rain')!.getTotalVertices()).toBe(192);
  }finally{system.dispose();scene.dispose();engine.dispose();}
});

it('мобильный режим не оставляет постобработку, переключение высокого качества восстанавливает её',()=>{
  // Arrange
  const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,3,-8),scene);
  const materials=Object.fromEntries(['road','water','windows'].map(key=>[key,material(scene,key,'#ffffff')]));
  const system=new Atmosphere(scene,camera,materials,'mobile');
  try{
    // Act / Assert
    const count=()=>scene.postProcessRenderPipelineManager.supportedPipelines.length;
    expect(count()).toBe(0);
    for(let i=0;i<3;i++){
      system.update(0,1/30,Vector3.Zero(),{hour:12,weather:'clear'},'high');expect(count()).toBe(1);
      system.update(0,1/30,Vector3.Zero(),{hour:12,weather:'clear'},'mobile');expect(count()).toBe(0);
      expect(scene.imageProcessingConfiguration.toneMappingEnabled).toBe(false);expect(scene.imageProcessingConfiguration.contrast).toBe(1);expect(scene.imageProcessingConfiguration.exposure).toBe(1);
    }
  }finally{system.dispose();scene.dispose();engine.dispose();}
});
