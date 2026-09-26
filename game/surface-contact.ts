import { Vector3 } from '@babylonjs/core';
import { indexWorld } from './chunks';
import { boundsOf } from './geometry';
import { projectOnSegment, sampleElevation } from './geo';
import type { World } from './types';

export type SurfaceContact = { height: number; normal: Vector3 };

export function worldSurfaceSampler(
  world: World,
  x: number,
  z: number,
  referenceY: number,
  reach = 2,
) {
  const segments = indexWorld(world).spatial.query(
    boundsOf([{ x, y: 0, z }], reach),
  );
  return (px: number, pz: number) => {
    let best: { score: number; height: number } | undefined;
    for (const segment of segments) {
      const projected = projectOnSegment(
        { x: px, y: 0, z: pz },
        segment.a,
        segment.b,
      );
      if (projected.distance > segment.edge.width / 2 + 1.5) continue;
      const score =
        projected.distance +
        Math.abs(projected.point.y - (referenceY - 0.8)) * 2;
      if (!best || score < best.score)
        best = { score, height: projected.point.y };
    }
    return best?.height ?? sampleElevation(world.elevation, px, pz);
  };
}
export function sampleWorldSurface(
  world: World,
  x: number,
  z: number,
  referenceY: number,
): SurfaceContact {
  const heightAt = worldSurfaceSampler(world, x, z, referenceY);
  const step = 0.45,
    height = heightAt(x, z),
    dx = heightAt(x + step, z) - heightAt(x - step, z),
    dz = heightAt(x, z + step) - heightAt(x, z - step);
  return { height, normal: new Vector3(-dx, step * 2, -dz).normalize() };
}
