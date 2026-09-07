import { distance2, resample, sampleRoadElevation, smoother } from './geo';
import type { ElevationGrid, OSMElement, Point } from './types';

type Segment = { key: string; from: number; to: number; a: Point; b: Point; kind: string; length: number; tunnel: boolean };

// OSM way — фрагмент разметки, а не отдельный мост. Профиль строится на всей
// неразветвлённой цепочке; геометрическое пересечение без общего узла её не соединяет.
export function structureProfiles(ways: OSMElement[], local: (id: number) => Point | null, elevation: ElevationGrid) {
  const profiles = new Map<string, (t: number) => number>(), segments: Segment[] = [];
  const adjacency = new Map<string, Segment[]>();
  const roadNeighbours = new Map<number, Set<number>>();
  for (const way of ways) for (let i = 0; i < (way.nodes?.length || 0) - 1; i++) {
    const from = way.nodes![i], to = way.nodes![i + 1], a = local(from), b = local(to);
    if (!a || !b || distance2(a, b) < .5) continue;
    for (const [id, next] of [[from, to], [to, from]]) { const neighbours = roadNeighbours.get(id) || new Set<number>(); neighbours.add(next); roadNeighbours.set(id, neighbours); }
  }
  for (const way of ways) {
    const tags = way.tags || {}, tunnel = !!tags.tunnel && !['no', 'building_passage'].includes(tags.tunnel);
    if ((!tags.bridge || tags.bridge === 'no') && !tunnel) continue;
    const kind = `${tunnel ? 'tunnel' : 'bridge'}:${tags.layer || (tunnel ? '-1' : '1')}`;
    for (let i = 0; i < (way.nodes?.length || 0) - 1; i++) {
      const from = way.nodes![i], to = way.nodes![i + 1], a = local(from), b = local(to);
      if (!a || !b || distance2(a, b) < .5) continue;
      const segment = { key: `${way.id}:${i}`, from, to, a, b, kind, length: distance2(a, b), tunnel };
      segments.push(segment);
      for (const id of [from, to]) { const key = `${kind}:${id}`, list = adjacency.get(key) || []; list.push(segment); adjacency.set(key, list); }
    }
  }
  const adjacent = (segment: Segment, node: number) => adjacency.get(`${segment.kind}:${node}`)!;
  // Наземный съезд тоже завершает цепочку: все дороги примыкания должны иметь
  // одну опорную высоту, независимо от порядка OSM-элементов.
  const continues = (segment: Segment, node: number) => roadNeighbours.get(node)?.size === 2 && adjacent(segment, node).length === 2;
  const visited = new Set<Segment>();
  function walk(seed: Segment, start: number) {
    const chain: { segment: Segment; reverse: boolean; offset: number }[] = [];
    let node = start, segment: Segment | undefined = seed, total = 0;
    while (segment && !visited.has(segment)) {
      visited.add(segment);
      const reverse = segment.to === node;
      chain.push({ segment, reverse, offset: total }); total += segment.length;
      node = reverse ? segment.from : segment.to;
      const candidates: Segment[] = adjacent(segment, node);
      segment = continues(segment, node) ? candidates.find(s => !visited.has(s)) : undefined;
    }
    const first = local(start)!, last = local(node)!;
    let minimum = Infinity;
    for (const { segment } of chain) for (const p of resample([segment.a, segment.b], 10)) minimum = Math.min(minimum, sampleRoadElevation(elevation, p.x, p.z));
    // layer задаёт порядок пересечений, а не высоту. Высокие берега уже обеспечивают
    // часть просвета; прибавлять к ним ещё один полный подъём нельзя.
    const requestedRise = seed.tunnel ? 8 : Math.max(0, 6.5 - (Math.min(first.y, last.y) - minimum));
    const gradeBudget = Math.max(0, .08 - Math.abs(last.y - first.y) / total);
    const ramp = Math.min(total * .4, Math.max(90, requestedRise * 1.875 / Math.max(.001, gradeBudget)));
    // При отсутствии данных подходов короткий пролёт не превращаем в трамплин.
    // Недостаточный просвет по-прежнему обнаруживает validateClearance.
    const rise = Math.min(requestedRise, gradeBudget * ramp / 1.875);
    for (const { segment, reverse, offset } of chain) profiles.set(segment.key, t => {
      const d = offset + segment.length * (reverse ? 1 - t : t);
      const base = first.y + (last.y - first.y) * d / total;
      return base + (seed.tunnel ? -rise : rise) * smoother(Math.min(d, total - d) / ramp);
    });
  }
  for (const segment of segments) if (!visited.has(segment)) {
    if (!continues(segment, segment.from)) walk(segment, segment.from);
    else if (!continues(segment, segment.to)) walk(segment, segment.to);
  }
  for (const segment of segments) if (!visited.has(segment)) walk(segment, segment.from);
  return profiles;
}
