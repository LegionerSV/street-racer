// Штрихи имеют длину в метрах и общую фазу вдоль исходного OSM way.
export function dashSpans(station:number,length:number,direction=1):[number,number][]{
  const end=station+length*direction,lo=Math.min(station,end),hi=Math.max(station,end),result:[number,number][]=[];
  for(let k=Math.floor(lo/9);k*9<hi;k++){
    const a=Math.max(lo,k*9),b=Math.min(hi,k*9+3);
    if(b<=a)continue;
    result.push(direction>0?[a-station,b-station]:[station-b,station-a]);
  }
  return result.sort((a,b)=>a[0]-b[0]);
}
