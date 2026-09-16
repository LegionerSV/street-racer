import type { Edge,SignalApproach,World } from './types';

export function signalAxis(heading:number):0|1{
  return Math.abs(Math.sin(heading))>Math.abs(Math.cos(heading))?1:0;
}

function approachHeading(edge:Edge){
  const b=edge.points.at(-1)!,a=edge.points.at(-2)??edge.points[0];
  return Math.atan2(b.x-a.x,b.z-a.z);
}

export function signalApproaches(world:World,nodeId:number):SignalApproach[]{
  const node=world.nodes.find(candidate=>candidate.id===nodeId);
  if(!node?.signal)return [];
  const direction=node.signalDirection?.trim().toLowerCase();
  return world.edges.filter(edge=>edge.to===nodeId&&edge.points.length>1).filter(edge=>{
    if(direction==='forward')return edge.laneProfile?.direction!==-1;
    if(direction==='backward')return edge.laneProfile?.direction===-1;
    return true;
  }).map(edge=>{
    const heading=approachHeading(edge);
    return {nodeId,edge:edge.stableId,heading,axis:signalAxis(heading),width:edge.width};
  }).filter((approach,index,all)=>all.findIndex(other=>Math.abs(Math.atan2(Math.sin(other.heading-approach.heading),Math.cos(other.heading-approach.heading)))<.12)===index);
}
