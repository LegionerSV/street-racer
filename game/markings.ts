// Штрихи имеют длину в метрах и общую фазу вдоль исходного OSM way.
export function dashSpans(station:number,length:number,direction=1,period=9,dash=3):[number,number][]{
  const end=station+length*direction,lo=Math.min(station,end),hi=Math.max(station,end),result:[number,number][]=[];
  for(let k=Math.floor(lo/period);k*period<hi;k++){
    const a=Math.max(lo,k*period),b=Math.min(hi,k*period+dash);
    if(b<=a)continue;
    result.push(direction>0?[a-station,b-station]:[station-b,station-a]);
  }
  return result.sort((a,b)=>a[0]-b[0]);
}

// Фонари и опоры привязаны к расстоянию, а не к числу вершин дорожного полотна.
export function periodicOffsets(station: number, length: number, direction = 1, period = 70, phase = 0): number[] {
  const end = station + length * direction, lo = Math.min(station, end), hi = Math.max(station, end), result: number[] = [];
  for (let k = Math.floor((lo - phase) / period); k * period + phase <= hi + 1e-7; k++) {
    const d = (k * period + phase - station) * direction;
    if (d >= -1e-7 && d < length - 1e-7) result.push(Math.max(0, d));
  }
  return result.sort((a, b) => a - b);
}
