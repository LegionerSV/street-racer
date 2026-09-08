import { describe, expect, it } from 'vitest';
import { buildWorld } from './network';
import { distance2, sampleElevation, sampleRoadElevation, smoothElevation, toLocal } from './geo';
import bridgeDEM from './fixtures/bolsheokhtinsky-elevation.json';
import { buildChunk, indexWorld } from './chunks';
import type { OSMElement, RegionData } from './types';
import { crossingClearance,roadCrossings } from './clearance';

const node = (id: number, x: number): OSMElement => ({ type: 'node', id, lat: 0, lon: x / 111320 });
const way = (id: number, nodes: number[], tags = {}): OSMElement => ({ type: 'way', id, nodes, tags: { highway: 'primary', bridge: 'yes', ...tags } });
const region = (elements: OSMElement[]): RegionData => ({ center: { lat: 0, lon: 0 }, elements, elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', fetchedAt: 'test' });
const grade = (points: { x: number; y: number; z: number }[]) => Math.max(...points.slice(1).map((p, i) => Math.abs(p.y - points[i].y) / distance2(p, points[i])));

describe('Профили высот дорог', () => {
  it('не оставляет ступень, если короткий подход переходит в другое сооружение',()=>{
    // Arrange
    const input=region([node(1,-450),node(2,-150),node(3,150),node(4,180),node(5,480),{...node(6,-130),lat:-100/111320},{...node(7,-130),lat:100/111320},way(10,[2,3]),way(11,[1,2],{bridge:'no'}),way(12,[3,4],{bridge:'no'}),way(13,[4,5],{bridge:'no',tunnel:'yes'}),way(14,[6,7],{bridge:'no'})]);
    // Act
    const world=buildWorld(input);
    // Assert
    for(const n of world.nodes)for(const e of world.edges){if(e.from===n.id)expect(e.points[0].y).toBeCloseTo(n.y,6);if(e.to===n.id)expect(e.points.at(-1)!.y).toBeCloseTo(n.y,6);}
  });
  it('обеспечивает просвет на реальном DEM Большеохтинского с двумя контрольными набережными',()=>{
    // Arrange — топология дорог синтетическая, координатная привязка и DEM реальные.
    const center=bridgeDEM.center;
    const nodeAt=(id:number,x:number,z:number):OSMElement=>({type:'node',id,lat:center.lat+z/111320,lon:center.lon+x/(111320*Math.cos(center.lat*Math.PI/180))});
    const elements=[nodeAt(1,-550,0),nodeAt(2,-230,0),nodeAt(3,230,0),nodeAt(4,550,0),nodeAt(5,-200,-200),nodeAt(6,-200,200),nodeAt(7,200,-200),nodeAt(8,200,200),way(10,[2,3]),way(11,[1,2],{bridge:'no'}),way(12,[3,4],{bridge:'no'}),way(13,[5,6],{bridge:'no',width:'14'}),way(14,[7,8],{bridge:'no',width:'14'})];
    // Act
    const world=buildWorld({center,elements,elevation:{...bridgeDEM,values:Float32Array.from(bridgeDEM.values)},drivingSide:'right',fetchedAt:'test'}),contacts=roadCrossings(world.edges);
    // Assert
    expect(new Set(contacts.map(c=>c.lower.edge.way))).toEqual(new Set([13,14]));
    for(const c of contacts)expect(crossingClearance(c)).toBeGreaterThanOrEqual(3.5);
    expect(world.edges.filter(e=>e.bridge).every(e=>!e.blocked)).toBe(true);
  });
  it.each([false,true])('поднимает весь мост и подходы над набережной, независимо от порядка way: %s', reverse => {
    // Arrange — пересечение возле берега, где старый профиль ещё почти на земле.
    const elements = [node(1,-450),node(2,-150),node(3,150),node(4,450),
      {...node(5,-130),lat:-100/111320},{...node(6,-130),lat:100/111320},
      way(10,[2,3]),way(11,[1,2],{bridge:'no'}),way(12,[3,4],{bridge:'no'}),way(13,[5,6],{bridge:'no',width:'14'})];
    // Act
    const world=buildWorld(region(reverse?[...elements].reverse():elements));
    const bridge=world.edges.find(e=>e.way===10)!;
    const lower=world.edges.find(e=>e.way===13)!;
    // Assert — 3,5 м до низа плиты толщиной 0,55 м по всей ширине набережной.
    for(const p of bridge.points.filter(p=>Math.abs(p.x+130)<=7)) expect(p.y-.55-lower.points[0].y).toBeGreaterThanOrEqual(3.5);
    expect(world.edges.every(e=>!e.blocked)).toBe(true);
    for(const edge of world.edges){
      expect(grade(edge.points)).toBeLessThan(.081);
      expect(edge.points[0].y).toBeCloseTo(world.nodes.find(n=>n.id===edge.from)!.y,7);
      expect(edge.points.at(-1)!.y).toBeCloseTo(world.nodes.find(n=>n.id===edge.to)!.y,7);
    }
    expect(world.nodes.find(n=>n.id===1)!.y).toBeCloseTo(.12,6);
  });
  it.each([false, true])('сшивает торцы разных OSM-путей на повороте (обратный путь: %s)', reverse => {
    // Arrange
    const input = region([
      { ...node(1, 0), lat: 100 / 111320 }, { ...node(2, 100), lat: 100 / 111320 }, { ...node(3, 100), lat: 200 / 111320 },
      way(10, [1, 2], { bridge: 'no' }), way(11, reverse ? [3, 2] : [2, 3], { bridge: 'no' }),
    ]);
    // Act
    const world = buildWorld(input), index = indexWorld(world), node2 = world.nodes.find(n => n.id === 2)!;
    const ends = [...index.owned.values()].flat().flatMap(segment => {
      const normal = distance2(segment.a, node2) < .001 ? segment.na : distance2(segment.b, node2) < .001 ? segment.nb : undefined;
      if (!normal) return [];
      return [[-1, 1].map(side => [node2.x + normal.x * segment.edge.width / 2 * side, node2.z + normal.z * segment.edge.width / 2 * side]).sort((a, b) => a[0] - b[0])];
    });
    // Assert
    expect(ends).toHaveLength(2);
    ends[0].forEach((corner, i) => corner.forEach((coordinate, axis) => expect(ends[1][i][axis]).toBeCloseTo(coordinate, 7)));
    expect(index.junctions.has(2)).toBe(false);
  });
  it('соединяет наземное примыкание между фрагментами моста независимо от порядка OSM', () => {
    // Arrange
    const nodes = [node(1, -300), node(2, 0), node(3, 300), { ...node(4, 0), lat: 100 / 111320 }];
    const bridges = [way(10, [1, 2]), way(11, [2, 3])], exit = way(12, [2, 4], { bridge: 'no' });
    // Act
    const worlds = [buildWorld(region([...nodes, ...bridges, exit])), buildWorld(region([...nodes, exit, ...bridges]))];
    // Assert
    for (const world of worlds) {
      const junction = world.nodes.find(n => n.id === 2)!;
      for (const edge of world.edges) {
        expect(edge.blocked).toBe(false);
        if (edge.from === 2) expect(edge.points[0].y).toBeCloseTo(junction.y, 8);
        if (edge.to === 2) expect(edge.points.at(-1)!.y).toBeCloseTo(junction.y, 8);
      }
    }
    for (const edge of worlds[0].edges) expect(worlds[1].edges.find(e => e.from === edge.from && e.to === edge.to)!.points).toEqual(edge.points);
  });

  it('не рисует горизонтальный перекрёсток на стыке двух OSM-путей внутри подъёма', () => {
    // Arrange
    const input = region([node(1, 10), node(2, 80), node(3, 410), way(10, [1, 2]), way(11, [2, 3])]);
    // Act
    const world = buildWorld(input), index = indexWorld(world);
    // Assert
    expect(index.junctions.has(2)).toBe(false);
    const edge = world.edges.find(e => e.from === 1 && e.to === 2)!;
    expect(edge.points.at(-1)!.y).toBeGreaterThan(edge.points.at(-2)!.y + .1);
  });
  it('не умножает фонари при более подробном профиле моста', () => {
    // Arrange
    const input = region([node(1, 10), node(2, 240), way(10, [1, 2])]);
    // Act
    const chunk = buildChunk(buildWorld(input), '0,0', 0);
    // Assert — интервал около 70 м, независимо от шага геометрии 2,5 м.
    expect(chunk.lamps.length).toBeGreaterThanOrEqual(3);
    expect(chunk.lamps.length).toBeLessThanOrEqual(4);
  });
  it('сохраняет углы кольца при более частой выборке высот', () => {
    // Arrange
    const input = region([
      { ...node(1, -55), lat: -55 / 111320 }, { ...node(2, 55), lat: -55 / 111320 },
      { ...node(3, 55), lat: 55 / 111320 }, { ...node(4, -55), lat: 55 / 111320 },
      way(10, [1, 2, 3, 4, 1], { bridge: 'no', oneway: 'yes' }),
    ]);
    // Act
    const world = buildWorld(input), route = world.routes.find(r => r.kind === 'circuit');
    // Assert
    expect(route).toBeDefined();
    expect(route!.length).toBeCloseTo(440, 3);
    for (const n of world.nodes) expect(route!.points.some(p => distance2(p, n) < .01)).toBe(true);
  });

  it('интерполирует перепад DEM без выброса и без перелома уклона на границе ячеек', () => {
    // Arrange
    const grid = { width: 5, size: 400, values: Float32Array.from({ length: 25 }, (_, i) => [0, 0, 8, 10, 10][i % 5]) };
    const sample = (x: number) => sampleRoadElevation(grid, x, 0);
    // Act
    const left = (sample(0) - sample(-.01)) / .01, right = (sample(.01) - sample(0)) / .01;
    const values = Array.from({ length: 401 }, (_, i) => sample(i - 200));
    // Assert
    expect(left).toBeCloseTo(right, 4);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(10);
    expect(values.every((v, i) => i === 0 || v >= values[i - 1] - 1e-12)).toBe(true);
  });

  it('проверяет реальный DEM Большеохтинского моста без сети', () => {
    // Arrange — координата объекта из Wikidata Q891580; это DEM, не геодезическая отметка полотна.
    const grid = { ...bridgeDEM, values: Float32Array.from(bridgeDEM.values) };
    const p = toLocal(59 + 56 / 60 + 33.75 / 3600, 30 + 24 / 60 + 4.75 / 3600, bridgeDEM.center);
    // Act
    const filtered = smoothElevation(grid);
    const rawHeight = sampleElevation(grid, p.x, p.z), filteredHeight = sampleRoadElevation(filtered, p.x, p.z);
    // Assert
    expect(rawHeight).toBeGreaterThan(10);
    expect(filteredHeight).toBeLessThan(rawHeight);
    expect(filtered.values.every(Number.isFinite)).toBe(true);
  });
  it('сохраняет единое полотно при разбиении моста на OSM-пути и смене направления пути', () => {
    // Arrange
    const nodes = [node(1, -300), node(2, -100), node(3, 100), node(4, 300)];
    const whole = region([...nodes, way(10, [1, 2, 3, 4])]);
    const split = region([...nodes, way(10, [1, 2]), way(11, [3, 2]), way(12, [3, 4])]);
    // Act
    const a = buildWorld(whole), b = buildWorld(split);
    // Assert
    for (const edge of a.edges) {
      const other = b.edges.find(e => e.from === edge.from && e.to === edge.to)!;
      expect(other.blocked).toBe(false);
      edge.points.forEach((p, i) => expect(other.points[i].y).toBeCloseTo(p.y, 5));
    }
    expect(b.nodes.find(n => n.id === 2)!.y).toBeGreaterThan(6);
  });

  it('не трактует номер слоя OSM как количество метров или этажей', () => {
    // Arrange
    const elements = [node(1, -300), node(2, 300)];
    // Act
    const a = buildWorld(region([...elements, way(10, [1, 2], { layer: '1' })]));
    const b = buildWorld(region([...elements, way(10, [1, 2], { layer: '5' })]));
    // Assert
    expect(b.edges[0].points.map(p => p.y)).toEqual(a.edges[0].points.map(p => p.y));
    expect(b.edges[0].layer).toBe(5);
  });

  it('ограничивает уклон короткого моста и плавно входит в подъём и выходит из него', () => {
    // Arrange
    const input = region([node(1, -25), node(2, 25), way(10, [1, 2])]);
    // Act
    const edge = buildWorld(input).edges[0];
    // Assert
    expect(edge.blocked).toBe(false);
    expect(grade(edge.points)).toBeLessThanOrEqual(.081);
    expect(edge.points.length).toBeGreaterThan(15);
    const startGrade = (edge.points[1].y - edge.points[0].y) / distance2(edge.points[0], edge.points[1]);
    expect(startGrade).toBeLessThan(.015);
  });

  it('не прибавляет повторный подъём к мосту между уже высокими берегами', () => {
    // Arrange
    const input = region([node(1, -300), node(2, 300), way(10, [1, 2])]);
    input.elevation = { width: 57, size: 5600, values: Float32Array.from({ length: 57 * 57 }, (_, i) => Math.abs(i % 57 - 28) < 2 ? 0 : 10) };
    // Act
    const world = buildWorld(input), edge = world.edges[0];
    // Assert
    const bank = Math.max(edge.points[0].y, edge.points.at(-1)!.y);
    expect(Math.max(...edge.points.map(p => p.y)) - bank).toBeLessThan(1);
  });

  it('убирает одиночную ошибку DEM, сохраняя масштаб широкого естественного склона', () => {
    // Arrange
    const width = 65, size = 1400;
    const values = Float32Array.from({ length: width * width }, (_, i) => (i % width - 32) * size / 64 * .03);
    values[32 * width + 32] += 80;
    // Act
    const grid = smoothElevation({ width, size, values });
    // Assert
    expect(Math.abs(sampleElevation(grid, 0, 0))).toBeLessThan(.5);
    expect(sampleElevation(grid, 400, 0) - sampleElevation(grid, -400, 0)).toBeCloseTo(24, 1);
    expect(values[32 * width + 32]).toBe(80);
  });
});
