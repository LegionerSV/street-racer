import { PhysicsAggregate, PhysicsShapeType, PhysicsRaycastResult, PhysicsPrestepType, Quaternion, Vector3, Scene } from '@babylonjs/core';
import type { PhysicsEngine } from '@babylonjs/core/Physics/v2/physicsEngine';
import { clamp, pointAt, pathLengths } from './geo';
import { createCar, setCarLights } from './visuals';
import { tyreGrip } from './weather';
import { NitroCharge } from './nitro';
import { laneOffsets } from './lanes';
import type { Edge, Point } from './types';
export class PlayerCar {
  readonly visual; readonly aggregate: PhysicsAggregate;
  readonly nitro=new NitroCharge();
  speed=0; steering=0; grounded=false; slip=0; wetness=0; offRoad=false; private hasDriven=false; private clock=0; private impact=0;
  constructor(private scene: Scene) {
    this.visual=createCar(scene,'#268fba','player');
    this.aggregate=new PhysicsAggregate(this.visual.root,PhysicsShapeType.BOX,{mass:1200,friction:.18,restitution:.22},scene);
    this.aggregate.body.setMassProperties({mass:1200,centerOfMass:new Vector3(0,-.28,0),inertia:new Vector3(1700/1200,2100/1200,760/1200)});
    this.aggregate.body.setAngularDamping(.55);this.aggregate.body.setLinearDamping(.015);
    this.aggregate.body.setCollisionCallbackEnabled(true);
    this.aggregate.body.getCollisionObservable().add(e=>{if(e.impulse>450)this.impact=.5;});
  }
  get groundSpeed(){const v=this.aggregate.body.getLinearVelocity();return Math.hypot(v.x,v.z);}
  get position():Vector3{return this.visual.root.position;}
  get heading(){const f=this.visual.root.getDirection(Vector3.Forward());return Math.atan2(f.x,f.z);}
  reset(edge:Edge,side:'left'|'right',d=10){
    const s=pointAt(edge.points,pathLengths(edge.points),Math.min(d,edge.length*.4)),o=laneOffsets(edge,side).at(-1)??0;
    this.teleport({x:s.point.x+Math.cos(s.heading)*o,y:s.point.y+.88,z:s.point.z-Math.sin(s.heading)*o},s.heading);
  }
  teleport(p:Point,heading:number){
    this.hasDriven=false;this.steering=0;this.speed=0;this.impact=0;this.nitro.interrupt();
    this.visual.root.position.copyFromFloats(p.x,p.y,p.z);this.visual.root.rotationQuaternion=Quaternion.RotationYawPitchRoll(heading,0,0);
    this.aggregate.body.setPrestepType(PhysicsPrestepType.TELEPORT);this.aggregate.body.disablePreStep=false;
    this.aggregate.body.setLinearVelocity(Vector3.Zero());this.aggregate.body.setAngularVelocity(Vector3.Zero());
  }
  step(dt:number,keys:Set<string>,hold:boolean){
    this.clock+=dt;this.impact=Math.max(0,this.impact-dt);
    const mesh=this.visual.root,body=this.aggregate.body;
    // После переноса сначала синхронизируем Havok, иначе силы приложатся к старому центру массы.
    if(!body.disablePreStep)return;
    mesh.computeWorldMatrix(true);
    const f=mesh.getDirection(Vector3.Forward()).normalize(),r=mesh.getDirection(Vector3.Right()).normalize(),up=mesh.getDirection(Vector3.Up()).normalize();
    const velocity=body.getLinearVelocity(),angular=body.getAngularVelocity();this.speed=Vector3.Dot(velocity,f);
    const boostRequest=keys.has('ShiftLeft')||keys.has('ShiftRight');
    const throttle=!hold&&(keys.has('KeyW')||keys.has('ArrowUp')||boostRequest),brake=!hold&&(keys.has('KeyS')||keys.has('ArrowDown')),handbrake=!hold&&keys.has('Space');
    if(throttle||brake)this.hasDriven=true;
    const parking=hold||!this.hasDriven;
    const input=hold?0:Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const grip=tyreGrip(this.wetness,this.offRoad),v=Math.abs(this.speed);
    this.steering+=(input-this.steering)*(1-Math.exp(-dt*(input===0?12:5.5)));
    // Клавиша задаёт кривизну, а угол колёс дополнительно учитывает увод упругих шин.
    const frontStiffness=1800,rearStiffness=2200;
    const maxLateralAcceleration=(this.speed>0&&!handbrake?12.5:8.5)*grip;
    const safeAngle=Math.atan(maxLateralAcceleration*2.75/Math.max(16,v*v));
    const baseAngle=this.steering*Math.min(.48,handbrake?Math.max(safeAngle,.22):safeAngle);
    const requestedYaw=Math.tan(baseAngle)*this.speed/2.75;
    const tyreCompensation=!handbrake&&this.speed>3?requestedYaw*1200/2.75*(1.4/(2*frontStiffness)-1.35/(2*rearStiffness)):0;
    const steerAngle=clamp(baseAngle+tyreCompensation,-.48,.48);
    const world=mesh.getWorldMatrix(),physics=this.scene.getPhysicsEngine() as unknown as PhysicsEngine;
    let contacts=0;
    for(let i=0;i<4;i++){
      const wheel=this.visual.wheels[i],mount=Vector3.TransformCoordinates(new Vector3(i%2?.82:-.82,.05,i<2?1.35:-1.4),world),result=new PhysicsRaycastResult();
      physics.raycastToRef(mount,mount.add(new Vector3(0,-1.2,0)),result,{ignoreBody:body});
      if(result.hasHit&&result.hitNormalWorld.y>.4){
        const distance=Vector3.Distance(mount,result.hitPointWorld),compression=Math.max(0,.96-distance);
        const pointVelocity=velocity.add(Vector3.Cross(angular,mount.subtract(mesh.position)));
        // Демпфер реагирует на скорость колеса, а не скачки луча на стыках треугольников.
        const normalSpeed=Vector3.Dot(pointVelocity,result.hitNormalWorld);
        const spring=clamp(compression*40000-normalSpeed*3400,0,18000);
        if(distance<1.02){
          body.applyForce(result.hitNormalWorld.scale(spring),mount);contacts++;
          const wheelRight=i<2?r.scale(Math.cos(steerAngle)).subtract(f.scale(Math.sin(steerAngle))):r;
          const sideSpeed=Vector3.Dot(pointVelocity,wheelRight),rearLock=handbrake&&i>=2;
          const stiffness=i<2?frontStiffness:rearStiffness,capacity=Math.max(1600,spring)*(i<2?1.25:1.4)*grip*(rearLock?.13:1);
          const lateral=clamp(-sideSpeed*stiffness,-capacity,capacity);
          body.applyForce(wheelRight.scale(lateral),mount);
        }
        wheel.position.y+=(clamp(.05-distance+.37,-.8,-.12)-wheel.position.y)*Math.min(1,dt*24);
      }else wheel.position.y+=(-.7-wheel.position.y)*Math.min(1,dt*16);
      wheel.rotation.y=i<2?steerAngle:0;
      if(!(handbrake&&i>=2))for(const child of wheel.getChildMeshes())child.rotation.x+=this.speed/.37*dt;
    }
    this.grounded=contacts>=2;this.slip=Math.atan2(Vector3.Dot(velocity,r),Math.abs(this.speed)+.1);
    const boost=this.nitro.step(dt,boostRequest,this.grounded&&this.speed>=0&&!brake&&!handbrake,hold);
    if(this.grounded){
      let drive=throttle&&!handbrake?9500*(1-clamp(this.speed,0,90)/90):0;
      if(brake)drive=this.speed>1?-16000:this.speed>-12?-4500:0;
      if(handbrake)drive-=clamp(this.speed*3000,-11000,11000);
      if(!throttle&&!brake)drive-=this.speed*65;
      if(parking)drive=-this.speed*9000+1200*9.81*f.y;
      drive=clamp(drive,-16500*grip,12500*grip);
      drive+=boost*8000*grip*(1-clamp(this.speed,0,110)/110);
      body.applyForce(f.scale(drive-this.speed*Math.abs(this.speed)*.8),mesh.position);
      if(this.impact<=0){
        const desiredYaw=handbrake?this.steering*this.speed/(11+v*.4)*1.5:requestedYaw;
        // Стабилизация плавно убирает лишнее вращение; ручник отключает помощь против заноса.
        const correction=(desiredYaw-angular.y)*(handbrake?1800:3500)+(handbrake?0:this.slip*2200*clamp(this.speed,-1,1));
        body.applyTorque(new Vector3(0,clamp(correction,handbrake?-3800:-5000,handbrake?3800:5000),0));
        if(!handbrake){const sideSpeed=Vector3.Dot(velocity,r);body.applyForce(r.scale(clamp(-sideSpeed*1300,-3200*grip,3200*grip)),mesh.position);}
      }
      const restoring=Vector3.Cross(up,Vector3.Up()).scale(2600);
      body.applyTorque(new Vector3(restoring.x-angular.x*1100,0,restoring.z-angular.z*900));
      body.applyForce(new Vector3(0,-Math.min(3800,this.speed*this.speed*.8),0),mesh.position);
    }
    setCarLights(this.visual,brake||handbrake||hold,0,this.clock);
  }
  afterPhysics(){if(!this.aggregate.body.disablePreStep)this.aggregate.body.disablePreStep=true;}
  dispose(){this.aggregate.dispose();this.visual.dispose();}
}
