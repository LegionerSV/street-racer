import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3, Mesh, VertexData, PhysicsAggregate, PhysicsShapeType, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { PlayerCar } from './vehicle';

it('машина проезжает по набережной под поднятым мостом без столкновения с плитой или опорами',async()=>{
  // Arrange — нижняя дорога пересекает начало подъёма, а не середину пролёта.
  const coordinates=[[-450,0],[-150,0],[150,0],[450,0],[-130,-120],[-130,120]];
  const world=buildWorld({center:{lat:0,lon:0},fetchedAt:'test',drivingSide:'right',elevation:{size:5600,width:2,values:new Float32Array(4)},elements:[
    ...coordinates.map(([x,z],i)=>({type:'node' as const,id:i+1,lat:z/111320,lon:x/111320})),
    {type:'way',id:10,nodes:[2,3],tags:{highway:'primary',bridge:'yes'}},
    {type:'way',id:11,nodes:[1,2],tags:{highway:'primary'}},{type:'way',id:12,nodes:[3,4],tags:{highway:'primary'}},
    {type:'way',id:13,nodes:[5,6],tags:{highway:'secondary',width:'14'}},
  ]});
  const havok=await HavokPhysics({wasmBinary:Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url))).buffer});
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  for(let x=-1;x<=0;x++)for(let z=-1;z<=0;z++){
    const chunk=buildChunk(world,`${x},${z}`,0);
    for(const role of ['terrain','road','sidewalks','structures'] as const){const data=chunk[role];if(!data?.indices.length)continue;const mesh=new Mesh(role,scene),vertices=new VertexData();vertices.positions=data.positions;vertices.indices=data.indices;vertices.applyToMesh(mesh);new PhysicsAggregate(mesh,PhysicsShapeType.MESH,{mass:0,friction:.65},scene);}
  }
  const car=new PlayerCar(scene);car.teleport({x:-126,y:1,z:-90},0);
  try{
    // Act
    for(let i=0;i<1200&&car.position.z<90;i++){car.step(1/60,new Set(car.speed<14?['KeyW']:[]),false);scene.getPhysicsEngine()!._step(1/60);car.afterPhysics();}
    // Assert
    expect(car.position.z).toBeGreaterThan(85);expect(car.grounded).toBe(true);expect(car.position.y).toBeLessThan(1.5);
  }finally{car.dispose();scene.dispose();engine.dispose();}
},20000);

it.each([['bridge',.003], ['tunnel',.003], ['tunnel',.00027]] as const)('машина проходит %s целиком с подходами (портал %s°)', async (kind,portalLon) => {
  // Arrange
  const world = buildWorld({ center: { lat: 0, lon: 0 }, fetchedAt: '2026-09-06', drivingSide: 'right', elevation: { size: 5600, width: 2, values: new Float32Array(4) }, elements: [
    { type: 'node', id: 1, lat: 0, lon: -.006 }, { type: 'node', id: 2, lat: 0, lon: -portalLon },
    { type: 'node', id: 3, lat: 0, lon: portalLon }, { type: 'node', id: 4, lat: 0, lon: .006 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', oneway: 'yes' } },
    { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'primary', oneway: 'yes', [kind]: 'yes' } },
    { type: 'way', id: 12, nodes: [3, 4], tags: { highway: 'primary', oneway: 'yes' } },
  ] });
  const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  for (let x = -3; x <= 2; x++) for (let z = -1; z <= 0; z++) {
    const chunk = buildChunk(world, `${x},${z}`, 0);
    for (const role of ['terrain', 'shoulders', 'sidewalks', 'road', 'structures'] as const) {
      const data = chunk[role]; if (!data?.indices.length) continue;
      const mesh = new Mesh(role, scene), vertices = new VertexData(); vertices.positions = data.positions; vertices.indices = data.indices; vertices.applyToMesh(mesh);
      new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: .65 }, scene);
    }
  }
  const endX = kind === 'tunnel' ? 610 : 390;
  const car = new PlayerCar(scene); car.teleport({ x: -endX, y: 1, z: -1 }, Math.PI / 2);
  let lowest = Infinity, highest = -Infinity;
  try {
    // Act
    for (let i = 0; i < 4200 && car.position.x < endX; i++) {
      const keys = new Set(car.speed < 23 ? ['KeyW'] : []);
      car.step(1 / 60, keys, false); scene.getPhysicsEngine()!._step(1 / 60); car.afterPhysics();
      if (Math.abs(car.position.x) < portalLon*111320*.35) { lowest = Math.min(lowest, car.position.y); highest = Math.max(highest, car.position.y); }
    }
    // Assert
    expect(car.position.x).toBeGreaterThan(endX - 5); expect(car.grounded).toBe(true); expect(car.position.y).toBeGreaterThan(.5);
    if (kind === 'bridge') expect(lowest, JSON.stringify({position:car.position,heading:car.heading,highest,lowest})).toBeGreaterThan(6);
    else { expect(highest, JSON.stringify({position:car.position,heading:car.heading,highest,lowest})).toBeLessThan(-5); expect(lowest).toBeGreaterThan(-9); }
  } finally { car.dispose(); scene.dispose(); engine.dispose(); }
}, 20000);
