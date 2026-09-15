import { expect, it } from 'vitest';
import moscow from './fixtures/landmarks/moscow.json';
import petersburg from './fixtures/landmarks/saint-petersburg.json';
import { appendBuilding } from './buildings';
import { buildWorld } from './network';
import { reduceMapElements } from './map-element-filter';
import type { Building, MeshData, OSMElement } from './types';
import { osmDirection, osmLength, roofForm } from './roof-forms';
import {
  encodeTileArtifact,
  decodeTileArtifact,
  TILE_BUILD_VERSION,
} from './tile-artifact';
import { sourceTileBounds } from './source-tiles';
import { createWorldPatch } from './world-patch';

const mesh = (): MeshData => ({ positions: [], indices: [], colors: [] });
const render = (b: Building, lod: number) => {
  const shell = mesh(),
    facades = [mesh(), mesh(), mesh(), mesh()];
  appendBuilding(b, lod, shell, facades);
  return {
    shell,
    triangles: [shell, ...facades].reduce(
      (n, m) => n + m.indices.length / 3,
      0,
    ),
  };
};
const building: Building = {
  id: 1,
  footprint: [
    { x: 0, y: 0, z: 0 },
    { x: 20, y: 0, z: 0 },
    { x: 20, y: 0, z: 30 },
    { x: 0, y: 0, z: 30 },
  ],
  height: 25,
  minHeight: 10,
  roofHeight: 15,
  colour: 0.5,
  roof: 'flat',
  roofColour: '#123456',
};
it.each([
  'dome',
  'onion',
  'cone',
  'round',
  'barrel',
  'mansard',
  'gambrel',
  'saltbox',
  'half-hipped',
  'gabled',
  'hipped',
  'pyramidal',
  'skillion',
])('форма %s сохраняет высоту крыши, цвет и дешёвый силуэт вдали', (roof) => {
  // Arrange / Act
  const near = render({ ...building, roof }, 0),
    far = render({ ...building, roof }, 2);
  // Assert
  for (const { shell } of [near, far]) {
    const ys = shell.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(25);
    expect(ys.some((y) => y >= 10 && y < 24)).toBe(true);
    expect(shell.positions.every(Number.isFinite)).toBe(true);
    expect(shell.colors).toContain(0x12 / 255);
  }
  expect(far.triangles).toBeLessThan(near.triangles);
  expect(near.triangles).toBeLessThan(800);
});
it('roof:height может занимать всю часть, неизвестная форма детерминированно плоская', () => {
  // Arrange / Act
  const flat = render(building, 0),
    unknown = render({ ...building, roof: 'many' }, 0);
  // Assert
  expect(unknown).toEqual(flat);
});
it('угол задаёт подъём, roof:height имеет приоритет, skillion понижается по направлению стока', () => {
  // Arrange
  const b = {
    ...building,
    roof: 'skillion',
    roofHeight: undefined,
    roofAngle: 30,
    roofDirection: 90,
    minHeight: 0,
  };
  // Act
  const form = roofForm(b, 0, 25, 0),
    explicit = roofForm({ ...b, roofHeight: 7 }, 0, 25, 0);
  // Assert
  expect(form.rise).toBeCloseTo(20 * Math.tan(Math.PI / 6));
  expect(explicit.rise).toBe(7);
  expect(form.planes[0]({ x: 20, y: 0, z: 0 })).toBeLessThan(
    form.planes[0]({ x: 0, y: 0, z: 0 }),
  );
  expect(osmDirection('sw')).toBe(225);
  expect(osmDirection('grey')).toBeUndefined();
  expect(osmLength('12.5 m')).toBe(12.5);
  expect(osmLength('10 ft')).toBeCloseTo(3.048);
  expect(osmLength('12;15')).toBeUndefined();
});
it('радиальная крыша сохраняет двор и не натягивается на вогнутый контур', () => {
  // Arrange / Act
  const withHole = roofForm(
    { ...building, roof: 'dome', holes: [building.footprint] },
    0,
    25,
    10,
  );
  const concave = roofForm(
    {
      ...building,
      roof: 'onion',
      footprint: [
        ...building.footprint.slice(0, 3),
        { x: 10, y: 0, z: 10 },
        building.footprint[3],
      ],
    },
    0,
    25,
    10,
  );
  // Assert
  expect(withHole.shape).toBe('flat');
  expect(concave.profile).toBeUndefined();
});
it('дальний LOD опускает только маленький декор группы, сохраняя отдельные башни', () => {
  // Arrange
  const detail = {
    ...building,
    group: 'relation/1',
    part: true,
    footprint: building.footprint.map((p) => ({
      ...p,
      x: p.x / 30,
      z: p.z / 30,
    })),
    height: 25,
    minHeight: 24,
    roof: 'dome',
    roofHeight: 1,
  };
  // Act / Assert
  expect(render(detail, 0).triangles).toBeGreaterThan(0);
  expect(render(detail, 2).triangles).toBe(0);
  expect(render({ ...detail, minHeight: 10 }, 2).triangles).toBeGreaterThan(0);
  expect(render({ ...detail, group: undefined }, 2).triangles).toBeGreaterThan(
    0,
  );
});
it('теги и зависимости Казанской верхушки переживают исходный тайл, worker clone и догрузку', () => {
  // Arrange
  const scenario = petersburg.find((s) => s.key === 'relation/11763697')!;
  const id = { z: 15, x: 19143, y: 9527 },
    bounds = sourceTileBounds(id);
  const raw = scenario.elements as OSMElement[];
  const input = {
    schemaVersion: 1 as const,
    tileBuildVersion: TILE_BUILD_VERSION,
    ...id,
    coreBounds: bounds,
    bufferedBounds: bounds,
    generatedAt: '2026-09-13T00:00:00Z',
    osmTimestamp: '2026-09-11T00:00:00Z',
    drivingSide: 'right' as const,
    elements: raw,
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  };
  // Act
  const decoded = decodeTileArtifact(encodeTileArtifact(input));
  const build = (elements: OSMElement[]) =>
    buildWorld({
      center: scenario.center,
      elements: reduceMapElements(elements, scenario.center).elements,
      elevation: decoded.elevation,
      drivingSide: 'right',
      fetchedAt: 'test',
    });
  const before = build(
      raw.filter((e) => !(e.type === 'way' && e.id === 1042588710)),
    ),
    after = structuredClone(build(decoded.elements));
  const patch = createWorldPatch(before, after);
  // Assert
  expect(after.buildings.find((b) => b.id === 1042588710)?.osmTags).toEqual(
    raw.find((e) => e.type === 'way' && e.id === 1042588710)!.tags,
  );
  expect(
    patch.buildingsAddedOrUpdated.find((b) => b.id === 1042588710),
  ).toMatchObject({ group: 'relation/11763697', roofMaterial: 'gold' });
  expect(patch.edgesRemoved).toEqual([]);
  expect(patch.dirtyChunks.length).toBeGreaterThan(0);
});
for (const [city, scenarios] of [
  ['Москва', moscow],
  ['Петербург', petersburg],
] as const) {
  it(`${city}: реальные формы и составные объекты проходят OSM → фильтр → мир → геометрия`, () => {
    for (const scenario of scenarios) {
      // Arrange
      const raw = scenario.elements as OSMElement[];
      const reduced = reduceMapElements(raw, scenario.center);
      // Act
      const world = buildWorld({
        center: scenario.center,
        elements: reduced.elements,
        elevation: { width: 2, size: 5600, values: new Float32Array(4) },
        fetchedAt: 'fixture',
        drivingSide: 'right',
      });
      // Assert
      expect(world.buildings.length, scenario.key).toBeGreaterThan(0);
      for (const b of world.buildings) {
        const near = render(b, 0),
          far = render(b, 2);
        expect(
          near.shell.positions.every(Number.isFinite),
          `${scenario.key}/${b.id}`,
        ).toBe(true);
        expect(far.triangles).toBeLessThanOrEqual(near.triangles);
      }
      if (scenario.key === 'relation/11763697') {
        const tip = world.buildings.find((b) => b.id === 1042588710);
        expect(tip).toMatchObject({
          roof: 'onion',
          roofHeight: 3,
          roofMaterial: 'gold',
          facadeColour: '#43b391',
          group: 'relation/11763697',
        });
        expect(world.buildings.find((b) => b.id === 827660972)?.group).toBe(
          tip?.group,
        );
      }
      if (scenario.key === 'relation/3224486') {
        expect(world.buildings.filter((b) => b.part).length).toBeGreaterThan(
          400,
        );
        expect(
          world.buildings.filter((b) => b.group === scenario.key).length,
        ).toBeGreaterThan(400);
        // Общая height=67 описывает габарит комплекса, а не сплошную стену
        // перед всеми отдельно размеченными башнями.
        const outline = world.buildings.find((b) => b.id === 3030568);
        expect(outline?.envelopeHeight).toBeLessThan(10);
        expect(outline?.osmTags?.height).toBe('67');
      }
      if (scenario.key === 'relation/1360656')
        expect(
          world.buildings.find((b) => b.id === 1360656)?.envelopeHeight,
        ).toBeGreaterThan(20);
      if (scenario.key === 'relation/1359278') {
        const outline = world.buildings.find((b) => b.id === 1359278);
        const firstUpperTier = Math.min(
          ...world.buildings
            .filter((b) => b.part && b.group === outline?.group)
            .map((b) => b.minHeight ?? 0)
            .filter((height) => height >= 3),
        );
        expect(outline?.envelopeHeight).toBeGreaterThanOrEqual(
          firstUpperTier - 1,
        );
        expect(outline?.osmTags?.height).toBe('0');
      }
      if (['relation/19710429', 'relation/3084697'].includes(scenario.key))
        expect(
          world.buildings.find((b) => `${b.osmType}/${b.id}` === scenario.key)
            ?.envelopeHeight,
        ).toBeLessThan(10);
    }
  }, 60000);
}
