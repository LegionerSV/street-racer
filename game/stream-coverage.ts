import type { Point } from './types';
import type { Bounds } from './geometry';
import { resample } from './geo';

export function coverageBounds(
  tiles?: string[],
  margin = 300,
): Bounds[] | undefined {
  return tiles?.map((key) => {
    const [x, z] = key.split(',').map(Number);
    return {
      minX: x * 1000 - margin,
      maxX: (x + 1) * 1000 + margin,
      minZ: z * 1000 - margin,
      maxZ: (z + 1) * 1000 + margin,
    };
  });
}

// Запас включает 70 м впереди, 20 м по сторонам, смещение полосы
// и промежуток между проверяемыми точками. Он действует при любом курсе.
export function routeHasCoverage(
  points: Point[],
  tiles?: string[],
  margin = 120,
) {
  if (!tiles) return true;
  const loaded = new Set(tiles);
  return (
    points.length > 0 &&
    resample(points, 20).every((p) => {
      for (
        let x = Math.floor((p.x - margin) / 1000);
        x <= Math.floor((p.x + margin) / 1000);
        x++
      )
        for (
          let z = Math.floor((p.z - margin) / 1000);
          z <= Math.floor((p.z + margin) / 1000);
          z++
        )
          if (!loaded.has(`${x},${z}`)) return false;
      return true;
    })
  );
}

export function needsRaceRecovery(
  active: boolean,
  loaded: Set<string> | null | undefined,
  critical: string[],
) {
  return (
    active &&
    !!loaded &&
    critical.some((key) => {
      const [x, z] = key.split(',').map(Number);
      return !loaded.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`);
    })
  );
}
