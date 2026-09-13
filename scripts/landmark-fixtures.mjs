import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
const root = 'work/landmark-inventory';
await mkdir('game/fixtures/landmarks', { recursive: true });
for (const city of ['moscow', 'saint-petersburg']) {
  const features = JSON.parse(
    await readFile(`${root}/${city}-features.json`, 'utf8'),
  );
  const summary = JSON.parse(
    await readFile(`${root}/${city}-summary.json`, 'utf8'),
  );
  const selected = new Set(
    Object.values(summary.frequencies['roof:shape']).map(
      (s) => s.examples[0].key,
    ),
  );
  for (const field of [
    'roof:angle',
    'roof:direction',
    'roof:colour',
    'roof:material',
  ])
    for (const s of Object.values(summary.frequencies[field] || {}))
      selected.add(s.examples[0].key);
  const complexes =
    city === 'moscow'
      ? [
          'relation/3224486',
          'relation/1360656',
          'relation/7624254',
          'relation/1359243',
          'relation/1359251',
          'relation/1359278',
          'relation/1359281',
          'relation/3028585',
          'relation/225033',
        ]
      : ['relation/11763697', 'relation/19710429', 'relation/3084697'];
  for (const f of features)
    if (/Успенский собор|Ивана Великого/.test(f.tags.name || ''))
      complexes.push(f.key);
  complexes.forEach((k) => selected.add(k));
  const manifest = JSON.parse(
    await readFile(`work/map-pilots/${city}/staging-manifest-v1.json`, 'utf8'),
  );
  const tileKeys = new Set(
    features.filter((f) => selected.has(f.key)).map((f) => f.tile),
  );
  const pool = new Map();
  for (const k of tileKeys) {
    const tile = JSON.parse(
      brotliDecompressSync(
        await readFile(`work/map-pilots/${city}/${manifest.tiles[k].path}`),
      ),
    );
    for (const e of tile.elements) pool.set(`${e.type}/${e.id}`, e);
  }
  const collect = (key, dest) => {
    const e = pool.get(key);
    if (!e || dest.has(key)) return;
    dest.set(key, e);
    for (const id of e.nodes || []) collect(`node/${id}`, dest);
    for (const m of e.members || []) collect(`${m.type}/${m.ref}`, dest);
  };
  const scenarios = [];
  for (const key of selected) {
    const dest = new Map();
    collect(key, dest);
    const points = [...dest.values()].filter(
      (e) => e.type === 'node' && e.lat !== undefined,
    );
    if (!points.length) continue;
    const west = Math.min(...points.map((p) => p.lon)),
      east = Math.max(...points.map((p) => p.lon));
    const south = Math.min(...points.map((p) => p.lat)),
      north = Math.max(...points.map((p) => p.lat));
    if (complexes.includes(key)) {
      for (const f of features)
        if (
          f.tags['building:part'] &&
          f.bounds &&
          f.bounds[0] >= west - 0.00001 &&
          f.bounds[2] <= east + 0.00001 &&
          f.bounds[1] >= south - 0.00001 &&
          f.bounds[3] <= north + 0.00001
        )
          collect(f.key, dest);
      // Настоящие окружающие улицы нужны для регрессии фильтра дворов.
      for (const e of pool.values())
        if (
          e.tags?.highway &&
          e.nodes?.some((id) => {
            const p = pool.get(`node/${id}`);
            return (
              p &&
              p.lon >= west - 0.003 &&
              p.lon <= east + 0.003 &&
              p.lat >= south - 0.002 &&
              p.lat <= north + 0.002
            );
          })
        )
          collect(`way/${e.id}`, dest);
    }
    scenarios.push({
      key,
      name: pool.get(key)?.tags?.name,
      complex: complexes.includes(key),
      center: { lat: (north + south) / 2, lon: (east + west) / 2 },
      elements: [...dest.values()],
    });
  }
  await writeFile(
    `game/fixtures/landmarks/${city}.json`,
    JSON.stringify(scenarios),
  );
  console.log(
    city,
    scenarios.length,
    scenarios
      .filter((s) => s.complex)
      .map((s) => ({
        key: s.key,
        name: s.name,
        elements: s.elements.length,
        parts: s.elements.filter((e) => e.tags?.['building:part']).length,
        roofs: s.elements
          .filter((e) =>
            ['onion', 'dome', 'cone'].includes(e.tags?.['roof:shape']),
          )
          .map((e) => `${e.type}/${e.id}`),
      })),
  );
}
