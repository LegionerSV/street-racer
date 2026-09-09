import {RACER_COLOURS} from './race-map-markers';
import { PhysicsAggregate, PhysicsMotionType, PhysicsShapeType, Quaternion, Scene, Vector3 } from '@babylonjs/core';
import type { Edge, Point, RacerTraits, Route, World } from './types';
import { allowedTurn, outgoing, advanceTurnHistory } from './network';
import { clamp, distance2, seeded } from './geo';
import { laneOffsets } from './lanes';
import { signalPhase } from './simulation';
import { smoothPath, samplePath, type DrivingPath } from './driving-path';
import { createTrafficCar, setCarLights, type CarVisual, type CarKind } from './visuals';
import {edgeKey} from './world-update';
import { createRacerTraits, DEFAULT_RACER_TRAITS, racingLineOffset } from './racing-ai';

type Plan={ids:number[]; ends:number[]; path:DrivingPath; total:number; exhausted:boolean};
type Agent={id:number;edge:number;distance:number;speed:number;point:Point;heading:number;stuck:number;visual?:CarVisual;body?:PhysicsAggregate;plan?:Plan;travel?:number;laneOffset?:number;avoidanceOffset?:number;avoidanceWay?:number;dynamic?:boolean;impact?:number;turn?:number;race?:{route:Route;index:number;lap:number;finished:boolean;progress:number;traits?:RacerTraits;finishTime?:number}};
export function trafficBudget(meters:number,density:'light'|'city'|'rush'='city',mobile=false){return Math.min(mobile?(density==='rush'?48:density==='city'?36:20):density==='rush'?220:density==='city'?144:72,Math.max(0,Math.floor(meters/(density==='rush'?22:density==='city'?35:70))));}
export class Traffic {
  agents:Agent[]=[];wetness=0;
  private mobile=false;
  setMobile(mobile:boolean){this.mobile=mobile;this.spawnTimer=0;}
  private sequence=0;private spawnTimer=0;private density:'light'|'city'|'rush'='city';
  private reservations=new Map<number,{id:number;until:number}>();
  private signals: Set<number>;
  constructor(private scene:Scene,private world:World){this.signals=new Set(world.nodes.filter(n=>n.signal).map(n=>n.id));}
  replaceWorld(world:World){
    if(this.agents.some(a=>a.race))throw new Error('Нельзя менять дорожную сеть во время гонки.');
    const ids=new Map(world.edges.filter(e=>!e.blocked).map(e=>[edgeKey(e),e.id]));
    this.agents=this.agents.filter(a=>{
      const id=ids.get(edgeKey(this.world.edges[a.edge]));
      if(id===undefined){this.hide(a);return false;}
      a.edge=id;a.plan=undefined;a.travel=a.distance;a.avoidanceOffset=undefined;a.avoidanceWay=undefined;return true;
    });
    this.world=world;this.signals=new Set(world.nodes.filter(n=>n.signal).map(n=>n.id));this.reservations.clear();
  }
  setDensity(d:'light'|'city'|'rush'){this.density=d;this.spawnTimer=0;}
  private makePlan(agent:Agent){
    const ids=agent.race?Array.from({length:agent.race.route.laps},()=>agent.race!.route.edges).flat():[agent.edge];
    if(agent.plan&&!agent.race)ids.splice(0,ids.length,...agent.plan.ids);
    let total=ids.reduce((sum,id)=>sum+this.world.edges[id].length,0);
    let history:number[]=[];for(const id of ids)history=advanceTurnHistory(this.world,history,this.world.edges[id].way);
    const goal=agent.race?total+100:(agent.travel||0)+700;let deadEnd=false;
    for(let n=0;total<goal&&n<600;n++){
      const edge=this.world.edges[ids.at(-1)!];
      let options=outgoing(this.world,edge.to).filter(e=>e.to!==edge.from&&allowedTurn(this.world,edge,e,history));
      if(!options.length){deadEnd=true;break;}
      options=options.sort((a,b)=>a.id-b.id);
      const next=options[Math.floor(seeded(agent.id*91+edge.to+ids.length)*options.length)];ids.push(next.id);total+=next.length;history=advanceTurnHistory(this.world,history,next.way);
    }
    const points:Point[]=[],ends:number[]=[];let length=0;
    for(const id of ids){const edge=this.world.edges[id];points.push(...(points.length?edge.points.slice(1):edge.points));length+=edge.length;ends.push(length);}
    agent.plan={ids,ends,total:length,path:smoothPath(points,Math.min(10,this.world.edges[agent.edge].width*.75)), exhausted:deadEnd};
    agent.travel??=agent.distance;
  }
  private homeLane(agent:Agent,edge:Edge){
    const offsets=laneOffsets(edge,this.world.drivingSide);
    return offsets[agent.id%offsets.length]??0;
  }
  private preferredLane(agent:Agent,edge:Edge){return agent.race&&agent.plan?racingLineOffset(agent.plan.path,agent.travel||0,edge,agent.race.traits||DEFAULT_RACER_TRAITS,agent.id):this.homeLane(agent,edge);}
  private lane(agent:Agent,edge:Edge){return agent.avoidanceOffset!==undefined&&agent.avoidanceWay===edge.way&&!edge.bridge&&!edge.tunnel?agent.avoidanceOffset:this.preferredLane(agent,edge);}
  private avoidanceLanes(agent:Agent,edge:Edge){
    const current=this.lane(agent,edge),legal=laneOffsets(edge,this.world.drivingSide).filter(offset=>Math.abs(offset-current)>.2).sort((a,b)=>Math.abs(a-current)-Math.abs(b-current));
    if(!agent.race||edge.bridge||edge.tunnel)return legal;
    const shoulder=edge.width/2+.35+(agent.race?.traits?.aggression??DEFAULT_RACER_TRAITS.aggression)*1.15;
    const shoulders=[shoulder,-shoulder].sort((a,b)=>Math.abs(a-current)-Math.abs(b-current));
    return [...legal,...shoulders].filter((offset,index,all)=>all.findIndex(other=>Math.abs(other-offset)<.2)===index);
  }
  private sample(agent:Agent,dt=1){
    if(!agent.plan)this.makePlan(agent);
    const plan=agent.plan!,d=clamp(agent.travel||0,0,plan.total);
    let idx=plan.ends.findIndex(end=>end>d);if(idx<0)idx=plan.ids.length-1;
    agent.edge=plan.ids[idx];agent.distance=d-(idx?plan.ends[idx-1]:0);
    const s=samplePath(plan.path,d,true),ahead=samplePath(plan.path,Math.min(plan.total,d+12),true);
    const delta=Math.atan2(Math.sin(ahead.heading-s.heading),Math.cos(ahead.heading-s.heading));
    agent.turn=Math.abs(delta)>.18?Math.sign(delta):0;
    const offset=this.lane(agent,this.world.edges[agent.edge]);agent.laneOffset??=offset;
    agent.laneOffset+=clamp(offset-agent.laneOffset,-dt*1.5,dt*1.5);
    agent.point={x:s.point.x+Math.cos(s.heading)*agent.laneOffset,y:s.point.y+.84,z:s.point.z-Math.sin(s.heading)*agent.laneOffset};agent.heading=s.heading;
    if(agent.race){
      const r=agent.race,graphLength=r.route.edges.reduce((sum,id)=>sum+this.world.edges[id].length,0);
      r.index=idx%r.route.edges.length;r.lap=Math.min(r.route.laps,Math.floor(d/graphLength)+1);
      r.progress=Math.min(d/graphLength*r.route.length,r.route.length*r.route.laps);
    }
  }
  private show(a:Agent){
    if(a.visual)return;const colors=a.race?RACER_COLOURS:['#657b88','#c6cac6','#43565c','#824b48','#b1a783','#4e6f6b'];
    const kinds:CarKind[]=['sedan','hatch','suv','sedan','van','hatch'];
    a.visual=createTrafficCar(this.scene,colors[a.id%colors.length],'traffic-'+a.id,a.race?'sport':kinds[a.id%kinds.length]);
    a.visual.root.position.copyFromFloats(a.point.x,a.point.y,a.point.z);a.visual.root.rotationQuaternion=Quaternion.RotationYawPitchRoll(a.heading,0,0);
    a.body=new PhysicsAggregate(a.visual.root,PhysicsShapeType.BOX,{mass:1200,friction:.18,restitution:.25},this.scene);
    a.body.body.setMassProperties({mass:1200,centerOfMass:new Vector3(0,-.25,0),inertia:new Vector3(1700/1200,2100/1200,760/1200)});
    a.body.body.setMotionType(PhysicsMotionType.ANIMATED);
    a.body.body.setCollisionCallbackEnabled(true);a.body.body.getCollisionObservable().add(e=>{if(e.impulse>400)a.impact=.7;});
  }
  private hide(a:Agent){a.body?.dispose();a.body=undefined;a.visual?.dispose();a.visual=undefined;a.dynamic=false;}
  startRace(route:Route){
    this.clearRacers();
    for(let i=0;i<3;i++){
      const a:Agent={id:i,edge:route.edges[0],distance:18+i*13,speed:0,point:{x:0,y:0,z:0},heading:0,stuck:0,race:{route,index:0,lap:1,finished:false,progress:0,traits:createRacerTraits()}};
      this.sample(a);this.agents.push(a);
    }
  }
  clearRacers(){for(const a of this.agents.filter(a=>a.race))this.hide(a);this.agents=this.agents.filter(a=>!a.race);}
  get racers(){return this.agents.filter(a=>a.race);}
  update(dt:number,time:number,player:Point,playerSpeed:number,raceRunning:boolean,raceElapsed=0){
    this.spawnTimer-=dt;
    if(this.spawnTimer<=0){
      this.spawnTimer=1;
      this.agents=this.agents.filter(a=>{if(!a.race&&(distance2(a.point,player)>(this.mobile?360:620)||(a.stuck>30&&distance2(a.point,player)>150))){this.hide(a);return false;}return true;});
      const near=this.world.edges.filter(e=>!e.blocked&&e.length>8&&distance2(e.points[0],player)>90&&distance2(e.points[0],player)<(this.mobile?260:480));
      const budget=trafficBudget(near.reduce((sum,e)=>sum+e.length,0),this.density,this.mobile);
      const keep=new Set(this.agents.filter(a=>!a.race).sort((a,b)=>distance2(a.point,player)-distance2(b.point,player)).slice(0,trafficBudget(Infinity,this.density,this.mobile)));
      this.agents=this.agents.filter(a=>{if(a.race||keep.has(a))return true;this.hide(a);return false;});
      const missing=budget-this.agents.filter(a=>!a.race).length;
      for(let i=0;i<Math.min(24,missing);i++)if(near.length){
        const id=++this.sequence+10,edge=near[Math.floor(seeded(id*799)*near.length)];
        const a:Agent={id,edge:edge.id,distance:edge.length*(.1+seeded(id*113)*.7),speed:edge.speed*.7,point:{x:0,y:0,z:0},heading:0,stuck:0};this.sample(a);
        if(this.agents.every(b=>distance2(b.point,a.point)>15 && !((edge.laneProfile?.shared??(edge.width<5.6&&!edge.oneWay))&&this.world.edges[b.edge].way===edge.way)))this.agents.push(a);
      }
    }
    // Решения принимаются по одному снимку, чтобы порядок массива не давал преимущество.
    const snapshot=this.agents.map(a=>({agent:a,point:a.dynamic&&a.visual? a.visual.root.position.clone():{...a.point},heading:a.heading,speed:a.speed}));
    for(const a of this.agents){
      if(!a.plan)this.makePlan(a);
      if(!a.race&&!a.plan!.exhausted&&a.plan!.total-(a.travel||0)<120){
        const cut=a.plan!.ends.findIndex(end=>end>(a.travel||0)-80);
        if(cut>0){const removed=a.plan!.ends[cut-1];a.plan!.ids.splice(0,cut);a.travel=(a.travel||0)-removed;}
        this.makePlan(a);
      }
      const plan=a.plan!,edge=this.world.edges[a.edge],traits=a.race?.traits||DEFAULT_RACER_TRAITS;
      if(a.avoidanceWay!==undefined&&(a.avoidanceWay!==edge.way||edge.bridge||edge.tunnel)){a.avoidanceOffset=undefined;a.avoidanceWay=undefined;}
      let gap=Infinity,leadSpeed=Infinity;const scanDistance=a.race?28+traits.reaction*42:60;
      for(const b of snapshot)if(b.agent!==a&&Math.abs(b.point.y-a.point.y)<2.5){
        const dx=b.point.x-a.point.x,dz=b.point.z-a.point.z,along=dx*Math.sin(a.heading)+dz*Math.cos(a.heading),lateral=Math.abs(dx*Math.cos(a.heading)-dz*Math.sin(a.heading));
        const aligned=Math.cos(b.heading-a.heading)>.45;
        if(aligned&&along>0&&along<scanDistance&&lateral<2.05&&along<gap){gap=along;leadSpeed=b.speed;}
      }
      const dx=player.x-a.point.x,dz=player.z-a.point.z,along=dx*Math.sin(a.heading)+dz*Math.cos(a.heading),lateral=Math.abs(dx*Math.cos(a.heading)-dz*Math.sin(a.heading));
      if(along>0&&lateral<2.05&&Math.abs(player.y-a.point.y)<2.5&&along<gap){gap=along;leadSpeed=playerSpeed;}
      const laneClear=(lane:number)=>{
        const shift=lane-(a.laneOffset??this.lane(a,edge)),margin=a.race?2.35-traits.aggression*.75:2.5,rear=a.race?-(16-traits.aggression*10):-14,front=a.race?45-traits.aggression*12:45;
        const clear=snapshot.every(b=>{if(b.agent===a||Math.abs(b.point.y-a.point.y)>3)return true;const dx=b.point.x-a.point.x,dz=b.point.z-a.point.z;const ahead=dx*Math.sin(a.heading)+dz*Math.cos(a.heading),lateral=dx*Math.cos(a.heading)-dz*Math.sin(a.heading)-shift;return ahead<rear||ahead>front||Math.abs(lateral)>margin;});
        const playerLateral=dx*Math.cos(a.heading)-dz*Math.sin(a.heading)-shift;
        const playerClear=Math.abs(player.y-a.point.y)>3||along<rear||along>front||Math.abs(playerLateral)>margin;
        return clear&&playerClear;
      };
      if(leadSpeed<a.speed+3&&gap<(a.race?16+traits.reaction*30:36)){
        const lane=this.avoidanceLanes(a,edge).find(laneClear);
        if(lane!==undefined){a.avoidanceOffset=lane;a.avoidanceWay=edge.way;}
      }else if(a.avoidanceOffset!==undefined&&laneClear(this.preferredLane(a,edge))){
        a.avoidanceOffset=undefined;a.avoidanceWay=undefined;
      }
      let stop=plan.total-(a.travel||0)-3;
      // Ищем светофор на нескольких коротких OSM-рёбрах вперёд.
      const index=plan.ends.findIndex(end=>end>(a.travel||0));
      for(let i=Math.max(0,index);i<plan.ids.length&&plan.ends[i]-(a.travel||0)<65;i++){
        const approaching=this.world.edges[plan.ids[i]],points=approaching.points,b=points.at(-1)!,c=points.at(-2)!;
        const axis=Math.abs(b.x-c.x)>Math.abs(b.z-c.z)?1:0,dist=plan.ends[i]-(a.travel||0);
        const nextEdge=this.world.edges[plan.ids[i+1]];
        if(nextEdge&&(nextEdge.laneProfile?.shared??(!nextEdge.oneWay&&nextEdge.width<5.6))&&snapshot.some(b=>b.agent!==a&&this.world.edges[b.agent.edge].way===nextEdge.way&&Math.cos(b.heading-a.heading)<0))stop=Math.min(stop,dist-5);
        if(!a.race&&this.signals.has(approaching.to)&&signalPhase(time,axis)!=='green')stop=Math.min(stop,dist-5);
        if(!a.race&&outgoing(this.world,approaching.to).length>2&&dist<20){
          const r=this.reservations.get(approaching.to);
          if(r&&r.id!==a.id&&r.until>time)stop=Math.min(stop,dist-5);
          else if(stop>=dist&&gap>12)this.reservations.set(approaching.to,{id:a.id,until:time+1.5});
        }
      }
      const look=samplePath(plan.path,Math.min(plan.total,(a.travel||0)+Math.max(12,a.speed*1.3)),true);
      const angle=Math.abs(Math.atan2(Math.sin(look.heading-a.heading),Math.cos(look.heading-a.heading)));
      const curve=angle/Math.max(12,a.speed*1.3),cornerSpeed=Math.sqrt((a.race?5.8+traits.accuracy*2.4:3.4)*(1-this.wetness*.4)/Math.max(.001,curve));
      const limit=Math.min(a.race?60:edge.speed*(.8+seeded(a.id)*.2),cornerSpeed);
      const ramming=!!a.race&&traits.aggression>.86&&gap<20&&leadSpeed<a.speed&&seeded(a.id*991+Math.floor(time*2))>.94;
      let target=Math.max(0,Math.min(limit,Math.sqrt(2*(a.race?8:4)*Math.max(0,stop-1)),ramming?Infinity:(gap-(a.race?4:5))/(a.race?.65:1.4)));
      if(a.race&&!raceRunning)target=0;
      const oldSpeed=a.speed,accel=a.race?9500/1200*(1-a.speed/90):2.7;
      a.speed=Math.max(0,a.speed+clamp(target-a.speed,-(a.race?11:7)*dt,accel*(1-this.wetness*.35)*dt));
      a.stuck=a.speed<.2?a.stuck+dt:0;
      a.impact=Math.max(0,(a.impact||0)-dt);
      if(a.dynamic&&a.body){
        const v=a.body.body.getLinearVelocity();
        if(a.impact>0)a.speed=Math.max(0,v.x*Math.sin(a.heading)+v.z*Math.cos(a.heading));
      }
      a.travel=(a.travel||0)+a.speed*dt;
      if(a.race&&!a.race.finished){
        const finish=a.race.route.edges.reduce((sum,id)=>sum+this.world.edges[id].length,0)*a.race.route.laps;
        if(a.travel>=finish){a.race.finished=true;a.race.finishTime=raceElapsed;}
      }
      this.sample(a,dt);
      // Вдали соперник освобождается от тупика, не меняя пройденные контрольные точки.
      if(a.race&&a.stuck>10&&distance2(a.point,player)>180){
        const candidate=samplePath(a.plan!.path,Math.min(a.plan!.total,(a.travel||0)+16),true);
        if(this.agents.every(b=>b===a||distance2(b.point,candidate.point)>12)){a.travel=(a.travel||0)+16;a.speed=8;a.stuck=0;this.sample(a,dt);}
      }
      if(distance2(a.point,player)<(this.mobile?300:500)){
        this.show(a);const body=a.body!.body,mesh=a.visual!.root;
        if(!a.dynamic&&distance2(a.point,player)<18){
          a.dynamic=true;body.setMotionType(PhysicsMotionType.DYNAMIC);body.setGravityFactor(0);
          body.setLinearVelocity(new Vector3(Math.sin(a.heading)*a.speed,0,Math.cos(a.heading)*a.speed));body.setAngularDamping(1);
        }
        if(a.dynamic){
          const velocity=body.getLinearVelocity(),error=new Vector3(a.point.x-mesh.position.x,a.point.y-mesh.position.y,a.point.z-mesh.position.z);
          body.applyForce(new Vector3(0,clamp(error.y*32000-velocity.y*8000,-24000,24000),0),mesh.position);
          const angular=body.getAngularVelocity(),up=mesh.getDirection(Vector3.Up()),upright=Vector3.Cross(up,Vector3.Up()).scale(a.impact?1200:5000);
          body.applyTorque(new Vector3(upright.x-angular.x*1700,0,upright.z-angular.z*1400));
          if(!a.impact){
            const desired=new Vector3(Math.sin(a.heading)*a.speed,0,Math.cos(a.heading)*a.speed),force=desired.subtract(velocity).scale(2200).add(new Vector3(error.x,0,error.z).scale(900));
            if(force.length()>14000)force.normalize().scaleInPlace(14000);body.applyForce(force,mesh.position);
            const f=mesh.getDirection(Vector3.Forward()),yaw=Math.atan2(f.x,f.z),angle=Math.atan2(Math.sin(a.heading-yaw),Math.cos(a.heading-yaw));
            body.applyTorque(new Vector3(0,clamp(angle*6000-body.getAngularVelocity().y*2500,-8000,8000),0));
          }
          if(distance2(mesh.position,player)>40&&error.length()<2&&!a.impact){a.dynamic=false;body.setMotionType(PhysicsMotionType.ANIMATED);}
        }
        if(!a.dynamic)body.setTargetTransform(new Vector3(a.point.x,a.point.y,a.point.z),Quaternion.RotationYawPitchRoll(a.heading,0,0));
        for(const [wheelIndex,wheel] of a.visual!.wheels.entries()){wheel.rotation.y=wheelIndex<2?a.turn!*.22:0;for(const child of wheel.getChildMeshes())child.rotation.x+=a.speed/.37*dt;}
        setCarLights(a.visual!,a.speed<oldSpeed-.015||target<.2,Math.abs(this.lane(a,edge)-(a.laneOffset||0))>.15?(this.lane(a,edge)>(a.laneOffset||0)?1:-1):a.turn||0,time);
      }else this.hide(a);
    }
    for(const [id,r]of this.reservations)if(r.until<time-3)this.reservations.delete(id);
  }
  dispose(){this.agents.forEach(a=>this.hide(a));this.agents=[];}
}
