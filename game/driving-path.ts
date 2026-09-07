import type { Point } from './types';
import { distance2, mixPoint, pathLengths, pointAt } from './geo';
export type DrivingPath = { points: Point[]; cumulative: number[]; length: number; stations: number[] };
export function smoothPath(input: Point[], radius = 8): DrivingPath {
  const anchors: (Point & { station: number })[] = []; let station=0, previous:Point|undefined;
  for (const original of input) {
    if(previous)station+=Math.hypot(original.x-previous.x,original.y-previous.y,original.z-previous.z);previous=original;const p={...original,station};
    if (anchors.length && distance2(anchors.at(-1)!, p) < .05) continue;
    while (anchors.length > 1) {
      const a = anchors.at(-2)!, b = anchors.at(-1)!;
      const u = Math.atan2(b.x - a.x, b.z - a.z), v = Math.atan2(p.x - b.x, p.z - b.z);
      if (Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u))) > .025 || Math.abs(b.y - mixPoint(a, p, distance2(a, b) / (distance2(a, p) || 1)).y) > .1) break;
      anchors.pop();
    }
    anchors.push(p);
  }
  if (anchors.length < 2) return { points: anchors, cumulative: [0], length: 0, stations: [0] };
  const points:Point[] = [anchors[0]], stations=[anchors[0].station];
  for (let i = 1; i < anchors.length - 1; i++) {
    const a = anchors[i - 1], b = anchors[i], c = anchors[i + 1];
    const trim = Math.min(radius, distance2(a, b) * .45, distance2(b, c) * .45);
    const start = mixPoint(b, a, trim / distance2(a, b)), end = mixPoint(b, c, trim / distance2(b, c));
    points.push(start);const startStation=b.station-(b.station-a.station)*trim/distance2(a,b),endStation=b.station+(c.station-b.station)*trim/distance2(b,c);stations.push(startStation);
    for (let j = 1; j <= 24; j++) { const t = j / 24; points.push(mixPoint(mixPoint(start, b, t), mixPoint(b, end, t), t));stations.push(startStation+(endStation-startStation)*t); }
  }
  points.push(anchors.at(-1)!);stations.push(anchors.at(-1)!.station);
  const cumulative = pathLengths(points); return { points, cumulative, length: cumulative.at(-1)!, stations };
}
export function samplePath(path: DrivingPath, distance: number, mapped=false) {
  if(mapped)path={...path,cumulative:path.stations,length:path.stations.at(-1)!};
  const current = pointAt(path.points, path.cumulative, distance);
  const before = pointAt(path.points, path.cumulative, Math.max(0, distance - .35)).point;
  const after = pointAt(path.points, path.cumulative, Math.min(path.length, distance + .35)).point;
  return { point: current.point, heading: Math.atan2(after.x - before.x, after.z - before.z) };
}
