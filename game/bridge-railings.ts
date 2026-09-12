import { CURB_WIDTH, SIDEWALK_WIDTH } from './clearance';
import { distance2, mixPoint } from './geo';
import { roadPrism, type Prism } from './geometry';
import type { Edge, Point } from './types';

type Segment = { a: Point; b: Point; edge: Edge };
// Вырезаем интервалы у основания, затем строим перила полной высоты.
// Обрезание готовой вертикальной стенки оставляло бы висящие верхушки.
function coveredInterval(
  a: Point,
  b: Point,
  mask: Prism,
): [number, number] | undefined {
  let start = 0,
    end = 1;
  for (const plane of mask.planes) {
    const at = (p: Point) =>
      plane.x * p.x + plane.y * p.y + plane.z * p.z + plane.w;
    const x = at(a),
      y = at(b);
    if (x < 0 && y < 0) return;
    if (x >= 0 && y >= 0) continue;
    const t = x / (x - y);
    if (x < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return;
  }
  return [start, end];
}
export function bridgeRailingSpans(
  a: Point,
  b: Point,
  edge: Edge,
  candidates: Segment[],
): { a: Point; b: Point }[] {
  let spans: [number, number][] = [[0, 1]];
  for (const other of candidates) {
    if (other.edge.way === edge.way || other.edge.tunnel) continue;
    if (other.edge.bridge && other.edge.layer !== edge.layer) continue;
    // На общем мосту перила не разделяют перекрывающиеся тротуары.
    // Наземный съезд вырезает только коридор проезда; дорога ниже моста не мешает.
    const width =
      other.edge.width +
      (other.edge.bridge ? 2 * (SIDEWALK_WIDTH + CURB_WIDTH) : 0) +
      0.3;
    const tolerance = other.edge.bridge ? 2 : 0.6;
    const length = distance2(other.a, other.b) || 1;
    const mask = roadPrism(
      mixPoint(other.a, other.b, -0.15 / length),
      mixPoint(other.a, other.b, 1 + 0.15 / length),
      width,
      tolerance,
      tolerance,
    );
    const cut = coveredInterval(a, b, mask);
    if (!cut) continue;
    spans = spans.flatMap(([start, end]) => {
      if (cut[1] <= start || cut[0] >= end)
        return [[start, end] as [number, number]];
      const pieces: [number, number][] = [];
      if (cut[0] > start) pieces.push([start, cut[0]]);
      if (cut[1] < end) pieces.push([cut[1], end]);
      return pieces;
    });
    if (!spans.length) break;
  }
  return spans
    .filter(([start, end]) => (end - start) * distance2(a, b) > 0.05)
    .map(([start, end]) => ({
      a: mixPoint(a, b, start),
      b: mixPoint(a, b, end),
    }));
}

export function embankmentRailingSpans(
  a: Point,
  b: Point,
  candidates: Segment[],
): { a: Point; b: Point }[] {
  // Мостовая маска работает во всём диапазоне высот: береговая секция должна
  // закончиться у устоя независимо от того, проходит дорога сверху или снизу.
  let spans: [number, number][] = [[0, 1]];
  for (const other of candidates) {
    if (!other.edge.bridge) continue;
    const length = distance2(other.a, other.b) || 1;
    const mask = roadPrism(
      mixPoint(other.a, other.b, -0.15 / length),
      mixPoint(other.a, other.b, 1 + 0.15 / length),
      other.edge.width + 2 * (SIDEWALK_WIDTH + CURB_WIDTH) + 0.3,
      10_000,
      10_000,
    );
    const cut = coveredInterval(a, b, mask);
    if (!cut) continue;
    spans = spans.flatMap(([start, end]) => {
      if (cut[1] <= start || cut[0] >= end)
        return [[start, end] as [number, number]];
      const pieces: [number, number][] = [];
      if (cut[0] > start) pieces.push([start, cut[0]]);
      if (cut[1] < end) pieces.push([cut[1], end]);
      return pieces;
    });
  }
  return spans
    .filter(([start, end]) => (end - start) * distance2(a, b) > 0.05)
    .map(([start, end]) => ({
      a: mixPoint(a, b, start),
      b: mixPoint(a, b, end),
    }));
}
