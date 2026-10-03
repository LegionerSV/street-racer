import { mixPoint } from './geo';
import type { Point } from './types';

export function shorelineSpans(a: Point, b: Point) {
  const cuts = new Set([0, 1]);
  for (const [start, end] of [
    [a.x, b.x],
    [a.z, b.z],
    [a.x + a.z, b.x + b.z],
  ]) {
    if (start === end) continue;
    for (
      let i = Math.ceil(Math.min(start, end) / 12.5);
      i <= Math.floor(Math.max(start, end) / 12.5);
      i++
    ) {
      const t = (i * 12.5 - start) / (end - start);
      if (t > 0 && t < 1) cuts.add(t);
    }
  }
  const ordered = [...cuts].sort((x, y) => x - y);
  return ordered
    .slice(1)
    .map((t, i) => ({ a: mixPoint(a, b, ordered[i]), b: mixPoint(a, b, t) }));
}
