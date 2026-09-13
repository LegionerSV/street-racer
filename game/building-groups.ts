import { polygonContains, projectOnSegment, toLocal } from './geo';
import { boundsOf, SpatialGrid } from './geometry';
import type { Building, Center, OSMElement, Point, Tags } from './types';

export const osmKey = (e: OSMElement) => `${e.type}/${e.id}`;
export const isBuildingPart = (t: Tags) =>
  !!t['building:part'] && t['building:part'] !== 'no';
export const isSignificantBuilding = (t: Tags) =>
  !!(
    t.historic ||
    t.heritage ||
    t.wikidata ||
    t.tourism === 'attraction' ||
    t.amenity === 'place_of_worship' ||
    ['cathedral', 'church', 'chapel', 'mosque', 'tower'].includes(t.building)
  );

// Только явная relation type=building или геометрическое включение в значимый
// объект. Близость, одинаковое имя и общий Wikidata не объединяют ансамбль.
export function buildingGroups(elements: OSMElement[], center: Center) {
  const byKey = new Map(elements.map((e) => [osmKey(e), e]));
  const groupOf = new Map<string, string>(),
    groups = new Map<string, Set<string>>();
  const link = (group: string, key: string) => {
    if (!byKey.has(key) || groupOf.has(key)) return;
    groupOf.set(key, group);
    const members = groups.get(group) ?? new Set<string>();
    members.add(key);
    groups.set(group, members);
  };
  const explicit = elements
    .filter((e) => e.type === 'relation' && e.tags?.type === 'building')
    .sort((a, b) => a.id - b.id);
  const graph = new Map<string, Set<string>>();
  for (const e of explicit)
    for (const m of e.members || [])
      if (['outline', 'part'].includes(m.role)) {
        const a = osmKey(e),
          b = `${m.type}/${m.ref}`;
        if (!byKey.has(b)) continue;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ]) {
          const list = graph.get(from) || new Set<string>();
          list.add(to);
          graph.set(from, list);
        }
      }
  for (const e of explicit) {
    const group = osmKey(e);
    if (groupOf.has(group)) continue;
    const pending = [group];
    while (pending.length) {
      const key = pending.pop()!;
      if (groupOf.has(key)) continue;
      link(group, key);
      pending.push(...(graph.get(key) || []));
    }
  }
  const ringCache = new Map<string, { outer: Point[][]; inner: Point[][] }>();
  const rings = (e: OSMElement) => {
    const cached = ringCache.get(osmKey(e));
    if (cached) return cached;
    const result: { outer: Point[][]; inner: Point[][] } = {
      outer: [],
      inner: [],
    };
    for (const role of ['outer', 'inner'] as const) {
      const chains =
        e.type === 'way'
          ? role === 'outer'
            ? [[...(e.nodes || [])]]
            : []
          : (e.members || [])
              .filter(
                (m) =>
                  m.type === 'way' &&
                  (role === 'inner'
                    ? m.role === 'inner'
                    : m.role === 'outer' || m.role === ''),
              )
              .map((m) => [...(byKey.get(`way/${m.ref}`)?.nodes || [])]);
      while (chains.length) {
        const chain = chains.pop()!;
        if (chain.length < 2) continue;
        while (chain[0] !== chain.at(-1)) {
          const i = chains.findIndex(
            (c) => c[0] === chain.at(-1) || c.at(-1) === chain.at(-1),
          );
          if (i < 0) break;
          const next = chains.splice(i, 1)[0];
          if (next.at(-1) === chain.at(-1)) next.reverse();
          chain.push(...next.slice(1));
        }
        if (chain[0] !== chain.at(-1)) continue;
        const nodes = chain.slice(0, -1).map((id) => byKey.get(`node/${id}`));
        if (
          nodes.length >= 3 &&
          nodes.every((n) => n?.lat !== undefined && n.lon !== undefined)
        )
          result[role].push(
            nodes.map((n) => toLocal(n!.lat!, n!.lon!, center)),
          );
      }
    }
    ringCache.set(osmKey(e), result);
    return result;
  };
  const anchors = new SpatialGrid<OSMElement>(150);
  for (const e of elements)
    if (
      e.tags?.building &&
      !isBuildingPart(e.tags) &&
      isSignificantBuilding(e.tags)
    ) {
      const points = rings(e).outer.flat();
      if (!points.length) continue;
      const bounds = boundsOf(points);
      // Не индексировать ошибочную оболочку размером с город.
      if (bounds.maxX - bounds.minX > 1500 || bounds.maxZ - bounds.minZ > 1500)
        continue;
      anchors.add(e, bounds);
    }
  for (const part of elements)
    if (isBuildingPart(part.tags || {}) && !groupOf.has(osmKey(part))) {
      const points = rings(part).outer.flat();
      if (!points.length) continue;
      const inside = (p: Point, ring: Point[]) =>
        polygonContains(p, ring) ||
        ring.some(
          (a, i) =>
            projectOnSegment(p, a, ring[(i + 1) % ring.length]).distance < 0.25,
        );
      const candidates = anchors
        .query(boundsOf(points))
        .filter((e) => {
          const r = rings(e);
          return (
            r.outer.some((ring) => points.every((p) => inside(p, ring))) &&
            !r.inner.some((h) => points.some((p) => polygonContains(p, h)))
          );
        })
        .sort((a, b) => {
          const area = (e: OSMElement) => {
            const b = boundsOf(rings(e).outer.flat());
            return (b.maxX - b.minX) * (b.maxZ - b.minZ);
          };
          return area(a) - area(b) || osmKey(a).localeCompare(osmKey(b));
        });
      if (candidates.length) {
        const anchor = osmKey(candidates[0]),
          group = groupOf.get(anchor) || anchor;
        link(group, anchor);
        link(group, osmKey(part));
      }
    }
  return { groupOf, groups };
}

export function resolveBuildingEnvelopes(buildings: Building[]) {
  const area = (ring: Point[]) =>
    Math.abs(
      ring.reduce(
        (n, p, i) =>
          n +
          p.x * ring[(i + 1) % ring.length].z -
          ring[(i + 1) % ring.length].x * p.z,
        0,
      ),
    ) / 2;
  const parts = new Map<string, Building[]>();
  for (const b of buildings)
    if (b.part && b.group) {
      const list = parts.get(b.group) || [];
      list.push(b);
      parts.set(b.group, list);
    }
  for (const b of buildings)
    if (!b.part && b.group) {
      const members = parts.get(b.group) || [];
      // Height оболочки часто является общей высотой вместе с башнями. В такой
      // группе оставляем приближённый цоколь до первого размеченного яруса,
      // иначе сплошная экструзия закрывает всю составную архитектуру.
      // Исходная высота остаётся в height/osmTags; оценка помечена отдельно.
      const elevated = members.filter((p) => (p.minHeight || 0) >= 3);
      const largest = Math.max(0, ...elevated.map((p) => area(p.footprint)));
      const broad =
        largest >= area(b.footprint) * 0.15
          ? elevated.filter((p) => area(p.footprint) >= largest * 0.7)
          : [];
      // У пространственно найденной группы мелкий карниз не задаёт высоту
      // всей оболочки: при наличии широкого яруса используем его основание.
      const candidates =
        b.group === `${b.osmType || 'way'}/${b.id}` && broad.length
          ? broad
          : members;
      const bases = candidates
        .map((p) => p.minHeight || 0)
        .filter((h) => h >= 3 && h < b.height);
      if (bases.length && members.some((p) => p.height >= b.height * 0.8))
        b.envelopeHeight = Math.max(b.minHeight || 0, Math.min(...bases));
    }
}
