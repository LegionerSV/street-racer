import type {Edge,Point,World} from './types';
import {indexWorld} from './chunks';
import {outgoing} from './network';
import {projectOnSegment,tileKey} from './geo';
export function drivingEdgeAt(world:World,position:Point,heading:number):Edge|undefined{
  const candidates=new Set<Edge>();
  for(const s of indexWorld(world).segments.get(tileKey(position.x,position.z))||[]){
    candidates.add(s.edge);
    for(const reverse of outgoing(world,s.edge.to))if(reverse.to===s.edge.from&&reverse.way===s.edge.way)candidates.add(reverse);
  }
  let best:Edge|undefined,score=Infinity;
  for(const edge of candidates)if(!edge.blocked)for(let i=1;i<edge.points.length;i++){
    const a=edge.points[i-1],b=edge.points[i],p=projectOnSegment(position,a,b);
    if(p.distance>Math.max(12,edge.width/2+3)||Math.abs(p.point.y-position.y)>2)continue;
    const alignment=Math.cos(Math.atan2(b.x-a.x,b.z-a.z)-heading),value=p.distance+(1-alignment);
    if(value<score){score=value;best=edge;}
  }
  return best;
}
