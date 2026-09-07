import type {Settings} from './types';
export const isLightQuality=(quality:string)=>quality==='low'||quality==='mobile';
export function resolutionScale(quality:Settings['quality'],width:number,height:number){
  return quality==='mobile'?Math.max(1.15,Math.sqrt(width*height/(960*540))):quality==='low'?1.5:1;
}
