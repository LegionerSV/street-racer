import { Vector3 } from '@babylonjs/core';
import {
  indexDrivingWorld as indexWorld,
  type DrivingSegment,
} from './driving-index';
import { boundsOf } from './geometry';
import { clamp, sampleElevation } from './geo';
import type { World } from './types';

export type SurfaceContact = { height: number; normal: Vector3 };
const contactSegments = new WeakMap<
  DrivingSegment,
  ReturnType<typeof prepareContactSegment>
>();

function prepareContactSegment({ a, b, edge }: DrivingSegment) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    margin = edge.width / 2 + 1.5;
  return {
    x: a.x,
    y: a.y,
    z: a.z,
    dx,
    dz,
    dy: b.y - a.y,
    lengthSquared: dx * dx + dz * dz || 1,
    margin,
    minX: Math.min(a.x, b.x) - margin,
    maxX: Math.max(a.x, b.x) + margin,
    minZ: Math.min(a.z, b.z) - margin,
    maxZ: Math.max(a.z, b.z) + margin,
  };
}

export function worldSurfaceSampler(
  world: World,
  x: number,
  z: number,
  referenceY: number,
  reach = 2,
) {
  const candidates = indexWorld(world).spatial.query(
    boundsOf([{ x, y: 0, z }], reach),
  );
  const segments = candidates
    .map((segment) => {
      let prepared = contactSegments.get(segment);
      if (!prepared) {
        prepared = prepareContactSegment(segment);
        contactSegments.set(segment, prepared);
      }
      return prepared;
    })
    .filter(
      (s) =>
        s.minX <= x + reach &&
        s.maxX >= x - reach &&
        s.minZ <= z + reach &&
        s.maxZ >= z - reach,
    );
  return (px: number, pz: number) => {
    let bestScore = Infinity,
      bestHeight: number | undefined;
    for (const s of segments) {
      if (px < s.minX || px > s.maxX || pz < s.minZ || pz > s.maxZ) continue;
      const t = clamp(
        ((px - s.x) * s.dx + (pz - s.z) * s.dz) / s.lengthSquared,
        0,
        1,
      );
      const distance = Math.hypot(px - (s.x + s.dx * t), pz - (s.z + s.dz * t));
      if (distance > s.margin) continue;
      const height = s.y + s.dy * t;
      const score = distance + Math.abs(height - (referenceY - 0.8)) * 2;
      if (score < bestScore) {
        bestScore = score;
        bestHeight = height;
      }
    }
    return bestHeight ?? sampleElevation(world.elevation, px, pz);
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
