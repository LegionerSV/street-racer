import { laneOffsets } from './lanes';
import { pathLengths, pointAt } from './geo';
import type { Edge, Point } from './types';

export type RecoverySample = {
  height: number;
  surfaceHeight: number;
  upY: number;
  grounded: boolean;
  speed: number;
};

export type RecoveryReason = 'below-surface' | 'upside-down';

export class RecoveryWatchdog {
  private belowSurfaceSeconds = 0;
  private upsideDownSeconds = 0;

  update(dt: number, sample: RecoverySample): RecoveryReason | null {
    const belowSurface = sample.height < sample.surfaceHeight - 3;
    const upsideDown =
      sample.upY < 0.2 && sample.grounded && Math.abs(sample.speed) < 5;
    this.belowSurfaceSeconds = belowSurface ? this.belowSurfaceSeconds + dt : 0;
    this.upsideDownSeconds = upsideDown ? this.upsideDownSeconds + dt : 0;
    if (this.belowSurfaceSeconds >= 0.15) return 'below-surface';
    if (this.upsideDownSeconds >= 1.49) return 'upside-down';
    return null;
  }

  reset() {
    this.belowSurfaceSeconds = 0;
    this.upsideDownSeconds = 0;
  }
}

export type RespawnPose = { point: Point; heading: number };

export function respawnPose(
  edge: Edge,
  side: 'left' | 'right',
  distance = 10,
): RespawnPose {
  const sample = pointAt(
      edge.points,
      pathLengths(edge.points),
      Math.max(0, Math.min(distance, edge.length)),
    ),
    offset = laneOffsets(edge, side).at(-1) ?? 0;
  return {
    point: {
      x: sample.point.x + Math.cos(sample.heading) * offset,
      y: sample.point.y + 0.88,
      z: sample.point.z - Math.sin(sample.heading) * offset,
    },
    heading: sample.heading,
  };
}

export function chooseClearRespawn(
  edge: Edge,
  side: 'left' | 'right',
  occupied: Point[],
  preferredDistance = 10,
  clearance = 8,
) {
  const preferred = Math.max(0, Math.min(preferredDistance, edge.length)),
    distances = new Set([preferred]);
  for (let offset = 12; offset <= edge.length + 12; offset += 12) {
    if (preferred + offset <= edge.length) distances.add(preferred + offset);
    if (preferred - offset >= 0) distances.add(preferred - offset);
  }
  distances.add(0);
  distances.add(edge.length);
  const candidates = [...distances].map((distance) =>
    respawnPose(edge, side, distance),
  );
  return candidates.find((candidate) =>
    occupied.every(
      (point) =>
        Math.hypot(
          candidate.point.x - point.x,
          candidate.point.z - point.z,
        ) >= clearance,
    ),
  );
}
