import type { Tags, LaneProfile, Edge } from './types';
import { clamp } from './geo';
export const roadTypes = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'road']);
export type RoadLayout = { width:number; total:number; forward:number; backward:number; bothWays:number; shared:boolean; oneWay:-1|0|1; source:'osm'|'estimated'; forwardTurns:string[][]; backwardTurns:string[][] };
const count=(value:string|undefined)=>value&&/^\d+$/.test(value.trim())?clamp(Number(value),0,12):undefined;
const turns=(value:string|undefined)=>value?.split('|').map(lane=>lane.split(';').map(s=>s.trim()).filter(Boolean))||[];
export function roadLayout(tags:Tags):RoadLayout{
  const explicit=tags.oneway?.toLowerCase(),oneWay:-1|0|1=explicit==='-1'?-1:['no','0','false'].includes(explicit||'')?0:['yes','1','true'].includes(explicit||'')||tags.junction==='roundabout'||tags.highway==='motorway'?1:0;
  const major=['motorway','trunk','primary','secondary'].includes(tags.highway);
  const forwardTurns=turns(tags['turn:lanes:forward']||(oneWay===1?tags['turn:lanes']:undefined)),backwardTurns=turns(tags['turn:lanes:backward']||(oneWay===-1?tags['turn:lanes']:undefined));
  const bothWays=count(tags['lanes:both_ways'])||0,tagged=count(tags.lanes);
  let forward=count(tags['lanes:forward'])??(forwardTurns.length||undefined),backward=count(tags['lanes:backward'])??(backwardTurns.length||undefined);
  let total=tagged||((forward!==undefined||backward!==undefined)?(forward??(oneWay===0?1:0))+(backward??(oneWay===0?1:0))+bothWays:major?(oneWay?2:4):oneWay?1:2);
  const source:RoadLayout['source']=tagged!==undefined||forward!==undefined||backward!==undefined?'osm':'estimated';
  if(oneWay===1){forward??=Math.max(0,total-(backward||0));backward??=Math.max(0,total-forward);total=Math.max(total,forward+backward);}
  else if(oneWay===-1){backward??=Math.max(0,total-(forward||0));forward??=Math.max(0,total-backward);total=Math.max(total,forward+backward);}
  else if(total<=1){
    if(forward===undefined&&backward===undefined)forward=backward=1;
    else{forward??=Math.max(0,1-(backward||0));backward??=Math.max(0,1-forward);}
    total=1;
  }
  else{
    const available=Math.max(2,total-bothWays);
    forward??=backward!==undefined?Math.max(0,available-backward):Math.ceil(available/2);
    backward??=Math.max(0,available-forward);
    total=forward+backward+bothWays;
  }
  const widthTag=parseFloat((tags.width||'').replace(',','.'));
  const width=clamp(Number.isFinite(widthTag)?widthTag*(/ft|'/.test(tags.width)? .3048:1):total*3.4,3,40);
  return {width,total,forward:forward!,backward:backward!,bothWays:oneWay?0:bothWays,shared:!oneWay&&forward!>0&&backward!>0&&(total===1||(source==='estimated'&&width<5.3)),oneWay,source,forwardTurns,backwardTurns};
}
export function directedLanes(layout:RoadLayout,side:'left'|'right',direction:1|-1):LaneProfile{
  const own=direction===1?layout.forward:layout.backward,opposite=direction===1?layout.backward:layout.forward,laneWidth=layout.width/layout.total;
  const offsets=layout.shared?[0]:Array.from({length:own},(_,i)=>-layout.width/2+((side==='right'?opposite+layout.bothWays:0)+i+.5)*laneWidth);
  const separators:LaneProfile['separators']=[];
  if(!layout.shared)for(let i=1;i<layout.total;i++){
    const divider=opposite>0&&(side==='right'?(i===opposite||i===opposite+layout.bothWays):(i===own||i===own+layout.bothWays));
    separators.push({offset:-layout.width/2+i*laneWidth,kind:divider?'divider':'lane'});
  }
  const raw=direction===1?layout.forwardTurns:layout.backwardTurns;
  return {direction,offsets,turns:offsets.map((_,i)=>raw[i]||[]),separators,opposite,shared:layout.shared,source:layout.source};
}
export function laneCaption(edge:Pick<Edge,'lanes'|'laneProfile'>):string{
  const n=edge.lanes,word=n%100>=11&&n%100<=14?'полос':n%10===1?'полоса':n%10>=2&&n%10<=4?'полосы':'полос';
  return `${edge.laneProfile?.source==='estimated'?'≈ ':''}${n} ${word}${edge.laneProfile?.shared?' · общий проезд':edge.laneProfile?` · ${edge.laneProfile.offsets.length} в вашем направлении`:''}`;
}
export function laneOffsets(edge:Edge,side:'left'|'right'):number[]{
  if(edge.laneProfile)return edge.laneProfile.offsets;
  const total=Math.max(1,edge.lanes),own=edge.oneWay?total:Math.max(1,Math.floor(total/2));
  return Array.from({length:own},(_,i)=>(edge.oneWay?-edge.width/2+(i+.5)*edge.width/own:(i+.5)*edge.width/2/own)*(side==='right'?1:-1));
}
