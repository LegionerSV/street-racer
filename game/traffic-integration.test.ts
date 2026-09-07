import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3, HavokPlugin, MeshBuilder, PhysicsAggregate, PhysicsShapeType } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { Traffic } from './traffic';
import { PlayerCar } from './vehicle';
import type { World, Edge, Route } from './types';
const setup=async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const havok=await HavokPhysics({wasmBinary:Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url))).buffer});
  scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));return{engine,scene};
};
const road=(id:number,from:number,to:number,z:number,length:number):Edge=>({id,from,to,way:1,length,width:6.8,lanes:2,oneWay:true,speed:25,name:'Испытательная улица',bridge:false,tunnel:false,layer:0,blocked:false,points:[{x:0,y:.12,z},{x:0,y:.12,z:z+length}]});
const world=(edges:Edge[]):World=>({center:{lat:0,lon:0},nodes:[],edges,restrictions:[],buildings:[],areas:[],trees:[],elevation:{width:2,size:5600,values:new Float32Array(4)},drivingSide:'right',warnings:[],spawnEdge:0,routes:[]});
it('обычная машина проезжает тысячи коротких сегментов и освобождает историю',async()=>{
  // Arrange
  const {engine,scene}=await setup(),w=world(Array.from({length:2300},(_,i)=>road(i,i,i+1,i,1))),traffic=new Traffic(scene,w);
  traffic.agents.push({id:12,edge:0,distance:2,speed:20,point:{x:0,y:.96,z:2},heading:0,stuck:0});
  try{
    // Act
    for(let i=0;i<6600;i++){const a=traffic.agents[0];traffic.update(1/60,i/60,{x:510,y:1,z:a.point.z},0,false);}
    // Assert
    expect(traffic.agents).toHaveLength(1);expect(traffic.agents[0].point.z).toBeGreaterThan(1800);
    expect(traffic.agents[0].plan!.ids.length).toBeLessThan(1000);
  }finally{traffic.dispose();scene.dispose();engine.dispose();}
},20000);
it('соперники получают спортивный разгон и трафик становится подвижным до столкновения',async()=>{
  // Arrange
  const {engine,scene}=await setup(),w=world([road(0,1,2,0,400)]),traffic=new Traffic(scene,w);
  const route:Route={id:'acceleration',kind:'sprint',title:'Разгон',edges:[0],points:w.edges[0].points,cumulative:[0,400],length:400,laps:1};
  traffic.startRace(route);
  try{
    // Act
    for(let i=0;i<360;i++)traffic.update(1/60,i/60,{x:510,y:1,z:0},0,true,i/60);
    // Assert — хотя бы лидер достигает 100 км/ч примерно за 6 секунд.
    expect(Math.max(...traffic.racers.map(a=>a.speed))*3.6).toBeGreaterThan(100);
    // Act — реальные PlayerCar и Traffic, а не отдельный неподвижный коллайдер.
    traffic.clearRacers();traffic.agents.push({id:12,edge:0,distance:25,speed:0,point:{x:-1.7,y:.96,z:25},heading:0,stuck:0});
    const floor=new PhysicsAggregate(MeshBuilder.CreateGround('floor',{width:1000,height:1000},scene),PhysicsShapeType.MESH,{mass:0},scene),car=new PlayerCar(scene);car.teleport({x:-1,y:.95,z:0},0);
    let dynamic=false,transferred=0;
    for(let i=0;i<240;i++){traffic.agents[0].speed=0;car.step(1/60,new Set(['KeyW']),false);traffic.update(1/60,i/60,car.position,car.speed,false);scene.getPhysicsEngine()!._step(1/60);car.afterPhysics();const a=traffic.agents[0];dynamic ||= !!a.dynamic;if(a.body)transferred=Math.max(transferred,a.body.body.getLinearVelocity().z);}
    // Assert
    expect(dynamic).toBe(true);expect(transferred).toBeGreaterThan(3);
    car.dispose();floor.dispose();
  }finally{traffic.dispose();scene.dispose();engine.dispose();}
},20000);
