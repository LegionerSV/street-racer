import { clamp } from './geo';
import { samplePath, type DrivingPath } from './driving-path';
import type { Edge, RacerTraits } from './types';

const turnDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const DEFAULT_RACER_TRAITS: RacerTraits = { accuracy: .76, aggression: .6, reaction: .75 };

export function createRacerTraits(random = Math.random): RacerTraits {
  return {
    accuracy: .6 + random() * .32,
    aggression: .25 + random() * .7,
    reaction: .5 + random() * .45,
  };
}

export function racerTraitWords(traits: RacerTraits): [string, string, string] {
  return [
    traits.accuracy < .7 ? 'НЕРВНЫЙ' : traits.accuracy < .84 ? 'ТОЧНЫЙ' : 'ЮВЕЛИР',
    traits.aggression < .48 ? 'ОСТОРОЖНЫЙ' : traits.aggression < .76 ? 'НАПОРИСТЫЙ' : 'ЖЁСТКИЙ',
    traits.reaction < .65 ? 'ЗАДУМЧИВЫЙ' : traits.reaction < .82 ? 'БЫСТРЫЙ' : 'МОЛНИЯ',
  ];
}

export function racingLineOffset(path: DrivingPath, distance: number, edge: Edge, traits: RacerTraits, racerId: number): number {
  const look=14+traits.reaction*18,current=samplePath(path,distance,true),before=samplePath(path,Math.max(0,distance-look),true),after=samplePath(path,Math.min(path.length,distance+look),true);
  const past=turnDelta(before.heading,current.heading),future=turnDelta(current.heading,after.heading),threshold=.035+(1-traits.reaction)*.035;
  let direction=0;
  if(Math.abs(past)>threshold&&Math.abs(future)>threshold&&Math.sign(past)===Math.sign(future))direction=Math.sign(past+future);
  else if(Math.abs(future)>threshold)direction=-Math.sign(future);
  else if(Math.abs(past)>threshold)direction=-Math.sign(past);
  const sidewalk=direction>0?edge.sidewalkRight:direction<0?edge.sidewalkLeft:false;
  const usable=Math.max(.4,edge.width/2-.95+(sidewalk&&!edge.bridge&&!edge.tunnel ? .9 : 0));
  const precision=.68+traits.accuracy*.3,error=Math.sin(distance*.035+racerId*2.17)*(1-traits.accuracy)*.8;
  return clamp(direction*usable*precision+error,-usable,usable);
}
