import type {Point} from './types';

export type TrafficMotion={point:Point;heading:number;speed:number};

export function trajectoryConflict(a:TrafficMotion,b:TrafficMotion,horizon=4,radius=4){
  const av={x:Math.sin(a.heading)*Math.max(0,a.speed),z:Math.cos(a.heading)*Math.max(0,a.speed)};
  const bv={x:Math.sin(b.heading)*Math.max(0,b.speed),z:Math.cos(b.heading)*Math.max(0,b.speed)};
  const dx=b.point.x-a.point.x,dz=b.point.z-a.point.z,dvx=bv.x-av.x,dvz=bv.z-av.z,relative=dvx*dvx+dvz*dvz;
  const time=relative>.001?Math.max(0,Math.min(horizon,-(dx*dvx+dz*dvz)/relative)):0;
  const separation=Math.hypot(dx+dvx*time,dz+dvz*time);
  if(separation>=radius)return null;
  return {time,separation,distance:a.speed*time};
}
