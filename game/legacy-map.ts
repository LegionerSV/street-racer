import type { OSMElement } from './types';
import type { MapBox } from './map-source';

// Повторяем выбор объектов по координатам, сохраняя все зависимости целиком.
// Обрезка way.nodes разрушила бы дороги, внешние контуры и отверстия зданий.
export function selectLegacyMap(
  elements: OSMElement[],
  box: MapBox,
): OSMElement[] | null {
  const key = (e: OSMElement) => `${e.type}/${e.id}`;
  const dependencies = (e: OSMElement) =>
    e.type === 'way'
      ? (e.nodes || []).map((id) => `node/${id}`)
      : e.type === 'relation'
        ? (e.members || []).map((m) => `${m.type}/${m.ref}`)
        : [];
  const source = new Map(elements.map((e) => [key(e), e])),
    parents = new Map<string, string[]>();
  for (const e of elements)
    for (const child of dependencies(e)) {
      const list = parents.get(child) || [];
      list.push(key(e));
      parents.set(child, list);
    }
  const selected = new Set<string>(),
    queue = elements
      .filter(
        (e) =>
          e.type === 'node' &&
          e.lat !== undefined &&
          e.lon !== undefined &&
          e.lat >= box.south &&
          e.lat <= box.north &&
          e.lon >= box.west &&
          e.lon <= box.east,
      )
      .map(key);
  while (queue.length) {
    const id = queue.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    queue.push(...(parents.get(id) || []));
  }
  const pending = [...selected],
    visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const e = source.get(id);
    if (!e) return null;
    selected.add(id);
    pending.push(...dependencies(e));
  }
  return elements.filter((e) => selected.has(key(e)));
}
