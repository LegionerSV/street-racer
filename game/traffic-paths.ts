import { pathLengths } from './geo';
import type { Point, World } from './types';

const lengthsByWorld = new WeakMap<World, WeakMap<Point[], number[]>>();

export function trafficPathLengths(world: World, points: Point[]) {
  let paths = lengthsByWorld.get(world);
  if (!paths) {
    paths = new WeakMap();
    lengthsByWorld.set(world, paths);
  }
  let lengths = paths.get(points);
  if (!lengths) {
    lengths = pathLengths(points);
    paths.set(points, lengths);
  }
  return lengths;
}
