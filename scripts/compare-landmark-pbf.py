"""Сравнение локальных диагностических XML с полным инвентарём поставки.

XML создаётся osmium extract; поставка и исходный PBF не изменяются.
Bounding box используется только для поиска кандидатов, не как доказательство
принадлежности архитектурному комплексу.
"""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path('work/landmark-inventory')
result = {}
for source, city, anchors in [
    ('rostral', 'saint-petersburg', [19710429, 3084697]),
    ('kazan', 'saint-petersburg', [11763697]),
    ('kremlin', 'moscow', [3030568, 1359243, 1359251, 1359278, 1359281, 3028585, 225033, 1360656]),
]:
    features = json.loads((root / f'{city}-features.json').read_text(encoding='utf8'))
    supplied = {f['key'] for f in features}
    objects = {}
    for _, e in ET.iterparse(root / f'{source}-source.osm', events=['end']):
        if e.tag not in ['node', 'way', 'relation']:
            continue
        key = e.tag + '/' + e.get('id')
        objects[key] = {
            'key': key,
            'tags': {t.get('k'): t.get('v') for t in e.findall('tag')},
            'refs': ['node/' + n.get('ref') for n in e.findall('nd')]
                    + [m.get('type') + '/' + m.get('ref') for m in e.findall('member')],
            'point': (float(e.get('lon')), float(e.get('lat'))) if e.tag == 'node' else None,
        }
        e.clear()

    def points(key, visited=None):
        visited = set() if visited is None else visited
        if key not in objects or key in visited:
            return []
        visited.add(key)
        obj = objects[key]
        return [obj['point']] if obj['point'] else [p for ref in obj['refs'] for p in points(ref, visited)]

    for anchor in anchors:
        key = 'relation/' + str(anchor)
        ps = points(key)
        if not ps:
            continue
        w, s = map(min, zip(*ps))
        e, n = map(max, zip(*ps))
        parts = []
        for part in objects.values():
            if not part['tags'].get('building:part'):
                continue
            ps = points(part['key'])
            if ps and all(w - .00001 <= x <= e + .00001 and s - .00001 <= y <= n + .00001 for x, y in ps):
                parts.append({'key': part['key'], 'tags': part['tags'], 'supplied': part['key'] in supplied})
        result[key] = {'name': objects[key]['tags'].get('name'), 'source': source, 'bounds': [w,s,e,n], 'parts': parts}
        print(key, result[key]['name'], 'PBF candidates:', len(parts), 'supplied:', sum(p['supplied'] for p in parts))
    named = [{'key': o['key'], 'tags': o['tags'], 'supplied': o['key'] in supplied} for o in objects.values() if 'Иван Великий' in o['tags'].get('name', '')]
    if named:
        result['ivan-veliky'] = named
(root / 'pbf-comparison.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
