// Только чтение поставок: один распакованный тайл в памяти, дедупликация type/id.
// Полный список кандидатов и точные частоты сохраняются отдельно от игрового экспорта.
import { readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'work/map-pilots');
const output = resolve(process.argv[3] || 'work/landmark-inventory');
await mkdir(output, { recursive: true });
const fields = [
  'building',
  'building:part',
  'height',
  'min_height',
  'building:levels',
  'building:min_level',
  'roof:shape',
  'roof:height',
  'roof:angle',
  'roof:direction',
  'roof:orientation',
  'roof:levels',
  'roof:colour',
  'roof:material',
  'building:colour',
  'building:material',
  'colour',
  'material',
  'historic',
  'man_made',
  'tower:type',
  'building:shape',
  'type',
];
const keyOf = (e) => `${e.type}/${e.id}`;
const candidate = (t) =>
  !!(
    t.landmark ||
    t.amenity === 'place_of_worship' ||
    ((t.building || t['building:part']) && (t.name || t['name:ru'])) ||
    t.historic ||
    t.wikidata ||
    t.heritage ||
    t.tourism ||
    t['building:part'] ||
    t['roof:shape'] ||
    ['cathedral', 'church', 'chapel', 'mosque', 'tower'].includes(t.building) ||
    ['tower', 'chimney', 'obelisk'].includes(t.man_made)
  );
for (const city of ['moscow', 'saint-petersburg']) {
  const manifest = JSON.parse(
    await readFile(join(root, city, 'staging-manifest-v1.json'), 'utf8'),
  );
  const seen = new Set(),
    features = [],
    relations = [],
    frequencies = {};
  let occurrences = 0,
    bytes = 0,
    maxTileElements = 0,
    duplicates = 0;
  const counts = {
    node: 0,
    way: 0,
    relation: 0,
    candidates: 0,
    buildings: 0,
    parts: 0,
  };
  const stream = await open(join(output, `${city}-candidates.ndjson`), 'w');
  for (const [tileKey, entry] of Object.entries(manifest.tiles)) {
    const path = resolve(root, city, entry.path);
    if (
      !path.startsWith(resolve(root, city) + '\\') &&
      !path.startsWith(resolve(root, city) + '/')
    )
      throw Error('Путь вне поставки');
    const buffer = await readFile(path);
    if (buffer.length !== entry.bytes) throw Error(`Размер тайла ${tileKey}`);
    bytes += buffer.length;
    const tile = JSON.parse(brotliDecompressSync(buffer).toString('utf8'));
    if (tile.checksum !== entry.checksum)
      throw Error(`Манифест/checksum ${tileKey}`);
    const nodes = new Map(
      tile.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]),
    );
    maxTileElements = Math.max(maxTileElements, tile.elements.length);
    for (const e of tile.elements) {
      occurrences++;
      const key = keyOf(e);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      counts[e.type]++;
      const t = e.tags || {},
        building = !!(t.building || t['building:part']);
      if (building) counts.buildings++;
      if (t['building:part']) counts.parts++;
      const points = (e.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
      const bounds = points.length
        ? [
            Math.min(...points.map((p) => p.lon)),
            Math.min(...points.map((p) => p.lat)),
            Math.max(...points.map((p) => p.lon)),
            Math.max(...points.map((p) => p.lat)),
          ]
        : undefined;
      if (building || candidate(t)) {
        const row = {
          key,
          tile: tileKey,
          tags: t,
          bounds,
          nodeCount: e.nodes?.length,
          members: e.members,
        };
        features.push(row);
        if (candidate(t)) {
          counts.candidates++;
          await stream.write(JSON.stringify(row) + '\n');
        }
        for (const field of new Set([
          ...fields,
          ...Object.keys(t).filter((k) => /^(roof:|building:)/.test(k)),
        ]))
          if (t[field] !== undefined) {
            const bucket = (frequencies[field] ??= {}),
              value = t[field];
            const stat = (bucket[value] ??= { count: 0, examples: [] });
            stat.count++;
            if (stat.examples.length < 4)
              stat.examples.push({
                key,
                name: t['name:ru'] || t.name,
                tile: tileKey,
              });
          }
      }
      if (e.type === 'relation')
        relations.push({ key, tags: t, members: e.members });
    }
  }
  await stream.close();
  const missingMembers = relations.flatMap((r) =>
    (r.members || [])
      .filter((m) => !seen.has(`${m.type}/${m.ref}`))
      .map((m) => ({ relation: r.key, ...m })),
  );
  const relationTypes = {},
    roles = {};
  for (const r of relations) {
    const type = r.tags.type || '(нет)';
    relationTypes[type] = (relationTypes[type] || 0) + 1;
    for (const m of r.members || []) {
      const k = `${type}/${m.type}/${m.role || '(пусто)'}`;
      roles[k] = (roles[k] || 0) + 1;
    }
  }
  const summary = {
    city,
    manifest: {
      planned: manifest.planned,
      complete: manifest.complete,
      tiles: Object.keys(manifest.tiles).length,
      bytes,
    },
    occurrences,
    duplicates,
    unique: seen.size,
    maxTileElements,
    counts,
    frequencies,
    relationTypes,
    roles,
    missingMembers,
  };
  await writeFile(
    join(output, `${city}-summary.json`),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    join(output, `${city}-features.json`),
    JSON.stringify(features),
  );
  await writeFile(
    join(output, `${city}-relations.json`),
    JSON.stringify(relations),
  );
  console.log(
    JSON.stringify({
      city,
      ...summary.manifest,
      occurrences,
      duplicates,
      counts,
      missingMembers: missingMembers.length,
      roofs: frequencies['roof:shape'],
      relationTypes,
    }),
  );
}
