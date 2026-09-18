import { describe, it, expect } from 'vitest';
import {
  desiredChunks,
  criticalChunks,
  startupDrivingChunks,
  ChunkBudget,
  ChunkInstallQueue,
  buildChunk,
} from './chunks';

it('оставляет полную детализацию рядом с машиной и ограничивает дальние кварталы', () => {
  // Arrange
  const position = { x: 125, y: 0, z: 125 };

  // Act
  const chunks = desiredChunks(position, 0, 'high', true);

  // Assert
  expect(chunks.find((chunk) => chunk.key === '1,1')?.lod).toBe(0);
  expect(chunks.find((chunk) => chunk.key === '2,0')?.lod).toBe(1);
  expect(chunks.find((chunk) => chunk.key === '2,2')).toBeUndefined();
});
import type { World } from './types';
import { polygonContains } from './geo';

describe('Подготовка кварталов', () => {
  it.each(['mobile', 'low', 'medium'] as const)(
    'готовит окружение стартовой машины со всех сторон: %s',
    (quality) => {
      // Arrange
      const position = { x: 125, y: 0, z: 125 };
      // Act
      const chunks = startupDrivingChunks(position, 0, quality);
      // Assert — после первого поворота камера не должна смотреть в пустой квартал.
      expect(chunks).toHaveLength(9);
      expect(chunks.map((c) => c.key)).toEqual(
        expect.arrayContaining(['-1,-1', '1,1', '-1,1', '1,-1']),
      );
      expect(chunks.every((c) => c.lod === 0)).toBe(true);
    },
  );
  it('на высоком качестве до поездки устанавливает девять ближних физических кварталов', () => {
    // Arrange
    const position = { x: 125, y: 0, z: 125 };
    // Act
    const chunks = startupDrivingChunks(position, 0, 'high');
    // Assert
    expect(chunks).toHaveLength(9);
    expect(chunks.every((chunk) => chunk.lod === 0)).toBe(true);
    expect(chunks.map((chunk) => chunk.key)).toContain('-1,-1');
    expect(chunks.map((chunk) => chunk.key)).toContain('1,1');
    expect(startupDrivingChunks({ x: 0, y: 0, z: 0 }, 0, 'high')).toHaveLength(
      9,
    );
  });
  it('хранит только ближнюю сцену на высоком качестве и готовит физику впереди на скорости', () => {
    // Arrange
    const position = { x: 125, y: 0, z: 125 };
    // Act
    const chunks = desiredChunks(position, 0, 'high', true);
    const fast = desiredChunks(position, 0, 'high', true, 200 / 3.6);
    // Assert
    expect(chunks.length).toBeLessThanOrEqual(40);
    expect(chunks.map((chunk) => chunk.key)).not.toContain('0,4');
    expect(fast.find((chunk) => chunk.key === '0,4')?.lod).toBe(0);
    expect(startupDrivingChunks(position, 0, 'high')).toHaveLength(9);
  });
  it('не строит тротуар у дворовой дороги', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 4,
      lanes: 1,
      speed: 7,
      name: 'Двор',
      category: 'service',
      sidewalkLeft: false,
      sidewalkRight: false,
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: false,
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const chunk = buildChunk(world, '0,0', 0);
    // Assert
    expect(chunk.sidewalks?.indices).toHaveLength(0);
  });
  it('рисует sett-дорогу материалом мостовой без изменения её ширины', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 10,
      name: 'Тестовая улица',
      surface: 'sett',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: false,
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;

    // Act
    const chunk = buildChunk(world, '0,0', 0);

    // Assert
    expect(chunk.paved?.indices.length).toBeGreaterThan(0);
    expect(chunk.paved?.uvs?.length).toBe(
      (chunk.paved!.positions.length / 3) * 2,
    );
    const xs = chunk.paved!.positions.filter((_, index) => index % 3 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(edge.width);
  });
  it('закрывает травяной грунт мощением площади и не создаёт внутри деревья', () => {
    // Arrange
    const area = {
      id: 1577673,
      kind: 'paved' as const,
      surface: 'sett',
      points: [
        { x: 20, y: 0, z: 20 },
        { x: 120, y: 0, z: 20 },
        { x: 120, y: 0, z: 120 },
        { x: 20, y: 0, z: 120 },
      ],
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [],
      restrictions: [],
      buildings: [],
      areas: [area],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const chunk = buildChunk(world, '0,0', 0);
    // Assert
    expect(chunk.paved?.indices.length).toBeGreaterThan(0);
    expect(
      chunk.paved?.positions
        .filter((_, index) => index % 3 === 1)
        .every((y) => y > 0.03),
    ).toBe(true);
    expect(chunk.trees).toHaveLength(0);
  });
  it('не ставит бетонные блоки на временном краю покрытия карты', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'набережная реки Фонтанки',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: true,
      blockedReasons: ['coverage'],
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const unfinished = buildChunk(world, '0,0', 0);
    edge.blockedReasons = ['clearance'];
    const closed = buildChunk(world, '0,0', 0);
    // Assert
    expect(unfinished.structures.indices).toHaveLength(0);
    expect(closed.structures.indices.length).toBeGreaterThan(0);
  });
  it('не оставляет тротуарный отступ на стороне без тротуара', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 6,
      lanes: 2,
      speed: 10,
      name: 'Улица',
      sidewalkLeft: true,
      sidewalkRight: false,
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: false,
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const shoulder = buildChunk(world, '0,0', 0).shoulders.positions;
    const xs = shoulder.filter((_, i) => i % 3 === 0);
    // Assert
    expect(xs.some((x) => Math.abs(x - 103.2) < 1e-6)).toBe(true);
    expect(xs.some((x) => Math.abs(x - 105.2) < 1e-6)).toBe(false);
  });
  it('добавляет ломкие ограждения только рекам и явно размеченным паркам', () => {
    // Arrange
    const square = (
      id: number,
      kind: 'water' | 'park',
      railing: World['areas'][number]['railing'],
    ) => ({
      id,
      kind,
      railing,
      points: [
        { x: 20, y: 0, z: 20 },
        { x: 80, y: 0, z: 20 },
        { x: 80, y: 0, z: 80 },
        { x: 20, y: 0, z: 80 },
      ],
    });
    const base = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [],
      restrictions: [],
      buildings: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as unknown as World;
    // Act
    const road = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 60,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Тестовая набережная',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 20, y: 0, z: 15 },
        { x: 80, y: 0, z: 15 },
      ],
      blocked: false,
    };
    const fenced = buildChunk(
      {
        ...base,
        edges: [road],
        areas: [square(1, 'water', 'river'), square(2, 'park', 'park')],
      },
      '0,0',
      0,
    );
    const open = buildChunk(
      {
        ...base,
        areas: [square(3, 'water', undefined), square(4, 'park', undefined)],
      },
      '0,0',
      0,
    );
    // Assert
    expect(
      fenced.breakables.filter((p) => p.kind === 'fence').length,
    ).toBeGreaterThan(0);
    expect(
      fenced.breakables
        .filter((p) => p.kind === 'fence')
        .map((p) => p.fenceType),
    ).toContain('embankment');
    expect(
      fenced.breakables
        .filter((p) => p.kind === 'fence')
        .map((p) => p.fenceType),
    ).toContain('park');
    expect(open.breakables).toHaveLength(0);
  });
  it('привязывает речное ограждение к тротуару набережной и прерывает его у моста', () => {
    // Arrange
    const road = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Тестовая набережная',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 20, y: 2, z: 15 },
        { x: 120, y: 2, z: 15 },
      ],
      blocked: false,
      sidewalkLeft: false,
      sidewalkRight: false,
    };
    const bridge = {
      ...road,
      id: 1,
      stableId: '2/3/4/0',
      way: 2,
      from: 3,
      to: 4,
      width: 10,
      name: 'Мост',
      bridge: true,
      layer: 1,
      points: [
        { x: 70, y: 7, z: 0 },
        { x: 70, y: 7, z: 50 },
      ],
    };
    const crossing = {
      ...road,
      id: 2,
      stableId: '3/5/6/0',
      way: 3,
      from: 5,
      to: 6,
      width: 8,
      name: 'Поперечная улица',
      points: [
        { x: 100, y: 2, z: 0 },
        { x: 100, y: 2, z: 50 },
      ],
    };
    const water = {
      id: 1,
      kind: 'water' as const,
      railing: 'river' as const,
      points: [
        { x: 10, y: 0, z: 21 },
        { x: 130, y: 0, z: 21 },
        { x: 130, y: 0, z: 80 },
        { x: 10, y: 0, z: 80 },
      ],
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [road, bridge, crossing],
      restrictions: [],
      buildings: [],
      areas: [water],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const fences = buildChunk(world, '0,0', 0).breakables.filter(
      (p) => p.kind === 'fence',
    );
    // Assert — секции идут по внешней стороне тротуара на высоте дороги, а не по OSM-контуру воды.
    expect(fences.length).toBeGreaterThan(0);
    expect(
      fences.every(
        (f) =>
          Math.abs(f.point.z - 20.7) < 1e-6 &&
          Math.abs(f.point.y - 2.15) < 1e-6,
      ),
    ).toBe(true);
    expect(fences.every((f) => Math.abs(f.point.x - 70) > 6)).toBe(true);
    expect(
      buildChunk(world, '0,0', 0).sidewalks!.indices.length,
    ).toBeGreaterThan(0);
    expect(
      fences.filter(
        (f) =>
          f.point.x + f.length! / 2 > 95.61 &&
          f.point.x - f.length! / 2 < 104.39,
      ),
    ).toEqual([]);
  });
  it('не превращает прилегающую к реке набережную в яму', () => {
    // Arrange
    const road = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Тестовая набережная',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 5, z: 20 },
        { x: 100, y: 5, z: 120 },
      ],
      blocked: false,
    };
    const water = {
      id: 1,
      kind: 'water' as const,
      railing: 'river' as const,
      points: [
        { x: 99, y: 0, z: 10 },
        { x: 180, y: 0, z: 10 },
        { x: 180, y: 0, z: 130 },
        { x: 99, y: 0, z: 130 },
      ],
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [road],
      restrictions: [],
      buildings: [],
      areas: [water],
      trees: [],
      elevation: {
        width: 2,
        size: 5600,
        values: new Float32Array([5, 5, 5, 5]),
      },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const terrain = buildChunk(world, '0,0', 0).terrain.positions;
    const bank = Array.from({ length: terrain.length / 3 }, (_, i) =>
      terrain.slice(i * 3, i * 3 + 3),
    ).filter((p) => p[0] === 100 && p[2] >= 25 && p[2] <= 112.5);
    // Assert
    expect(Math.min(...bank.map((p) => p[1]))).toBeGreaterThan(4);
  });
  it('ждёт только стартовую зону и путь на 70 м вперёд с запасом у границ', () => {
    // Arrange / Act / Assert
    expect(criticalChunks({ x: 125, y: 0, z: 125 }, 0)).toEqual(['0,0']);
    expect(new Set(criticalChunks({ x: 0, y: 0, z: 0 }, 0))).toEqual(
      new Set(['-1,-1', '-1,0', '0,-1', '0,0']),
    );
    expect(new Set(criticalChunks({ x: 125, y: 0, z: 220 }, 0))).toEqual(
      new Set(['0,0', '0,1']),
    );
    expect(criticalChunks({ x: 2490, y: 0, z: 2490 }, 0)).toEqual(['9,9']);
  });
  it('на скорости 200 км/ч готовит физические кварталы на четыре клетки вперёд', () => {
    // Arrange
    const position = { x: 125, y: 0, z: 125 };
    // Act
    const slow = desiredChunks(position, 0, 'mobile', true, 0),
      fast = desiredChunks(position, 0, 'mobile', true, 200 / 3.6),
      ahead = fast.findIndex((chunk) => chunk.key === '0,4'),
      side = fast.findIndex((chunk) => chunk.key === '2,0');
    // Assert
    expect(slow.some((chunk) => chunk.key === '0,4')).toBe(false);
    expect(fast[ahead]?.lod).toBe(0);
    expect(ahead).toBeLessThan(side);
    expect(fast[0].key).toBe('0,0');
  });
  it('тротуар не пересекает проезжую часть на перекрёстке', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Улица',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: false,
    };
    const world = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [
        edge,
        {
          ...edge,
          id: 1,
          stableId: '2/3/4/0',
          way: 2,
          from: 3,
          to: 4,
          points: [
            { x: 50, y: 0, z: 70 },
            { x: 150, y: 0, z: 70 },
          ],
        },
      ],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const mesh = buildChunk(world, '0,0', 0).sidewalks!;
    // Assert
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const points = mesh.indices.slice(i, i + 3).map((j) => ({
        x: mesh.positions[j * 3],
        y: mesh.positions[j * 3 + 1],
        z: mesh.positions[j * 3 + 2],
      }));
      for (const p of [
        { x: 104, y: 0, z: 70 },
        { x: 96, y: 0, z: 70 },
        { x: 100, y: 0, z: 74 },
        { x: 100, y: 0, z: 66 },
      ])
        expect(polygonContains(p, points)).toBe(false);
    }
  });
  it.each(['road', 'bridge', 'tunnel'])(
    'строит тротуары шириной 2 м и поребрики высотой 15 см: %s',
    (kind) => {
      // Arrange
      const world = {
        center: { lat: 0, lon: 0 },
        nodes: [],
        edges: [
          {
            id: 0,
            stableId: '1/1/2/0',
            way: 1,
            from: 1,
            to: 2,
            length: 100,
            width: 7,
            lanes: 2,
            speed: 14,
            name: 'Улица',
            bridge: kind === 'bridge',
            tunnel: kind === 'tunnel',
            layer: kind === 'bridge' ? 1 : 0,
            points: [
              { x: 100, y: 1, z: 20 },
              { x: 100, y: 3, z: 120 },
            ],
            blocked: false,
          },
        ],
        restrictions: [],
        buildings: [],
        areas: [],
        trees: [],
        elevation: { width: 2, size: 5600, values: new Float32Array(4) },
        drivingSide: 'right',
        warnings: [],
        spawnEdge: null,
        routes: [],
      } as World;
      // Act
      const mesh = buildChunk(world, '0,0', 0).sidewalks;
      // Assert
      expect(mesh?.indices.length).toBeGreaterThan(0);
      const positions = mesh!.positions,
        points = Array.from({ length: positions.length / 3 }, (_, i) =>
          positions.slice(i * 3, i * 3 + 3),
        );
      for (const side of [-1, 1])
        for (const offset of [3.5, 3.7, 5.7])
          expect(
            points.some((p) => Math.abs(p[0] - (100 + side * offset)) < 1e-6),
          ).toBe(true);
      for (const p of points)
        expect(p[1] - (1 + (p[2] - 20) * 0.02)).toBeLessThanOrEqual(0.150001);
      expect(
        points.some(
          (p) => Math.abs(p[1] - (1 + (p[2] - 20) * 0.02) - 0.15) < 1e-6,
        ),
      ).toBe(true);
    },
  );
  it('сохраняет ограниченный набор кварталов при длительной езде', () => {
    // Arrange
    const budget = new ChunkBudget(64);
    // Act
    for (let i = 0; i < 1000; i++) budget.touch(String(i), i);
    // Assert
    expect(budget.size).toBe(64);
    expect(budget.has('999')).toBe(true);
    expect(budget.has('0')).toBe(false);
  });
  it('вытесняет старую геометрию по объёму и не кэширует квартал крупнее бюджета', () => {
    // Arrange
    const budget = new ChunkBudget(10, 100, (value: number) => value);
    budget.touch('old', 60);
    budget.touch('new', 60);
    // Act
    budget.touch('oversized', 120);
    // Assert
    expect(budget.has('old')).toBe(false);
    expect(budget.get('new')).toBe(60);
    expect(budget.has('oversized')).toBe(false);
    expect(budget.weight).toBe(60);
  });
  it('освобождает объём заменённых и инвалидированных кварталов', () => {
    // Arrange
    const budget = new ChunkBudget(10, 100, (value: number) => value);
    budget.touch('0,0/0', 60);
    // Act
    budget.touch('0,0/0', 20);
    budget.touch('1,0/0', 70);
    budget.invalidateChunks(['0,0']);
    // Assert
    expect(budget.weight).toBe(70);
    expect(budget.has('0,0/0')).toBe(false);
    expect(budget.has('1,0/0')).toBe(true);
  });
  it('инвалидирует в кэше только указанные chunkKey на всех LOD', () => {
    // Arrange
    const budget = new ChunkBudget<number>(8);
    budget.touch('0,0/0', 1);
    budget.touch('0,0/1', 2);
    budget.touch('1,0/0', 3);
    // Act
    budget.invalidateChunks(['0,0']);
    // Assert
    expect(budget.has('0,0/0')).toBe(false);
    expect(budget.has('0,0/1')).toBe(false);
    expect(budget.get('1,0/0')).toBe(3);
  });
  it('устанавливает фоновые chunks покадрово в пределах бюджета', () => {
    // Arrange
    const queue = new ChunkInstallQueue<number>(3),
      installed: number[] = [];
    queue.enqueue('a', 1);
    queue.enqueue('b', 2);
    queue.enqueue('c', 3);
    const times = [0, 2, 4],
      now = () => times.shift() ?? 4;
    // Act
    const result = queue.drain((value) => installed.push(value), now);
    // Assert
    expect(result).toEqual({ installed: 2, installMs: 4 });
    expect(installed).toEqual([1, 2]);
    expect(queue.size).toBe(1);
  });
  it('разбивает установку одного тяжёлого квартала на несколько кадров', () => {
    // Arrange
    const queue = new ChunkInstallQueue<number>(3),
      steps: number[] = [];
    queue.enqueue('heavy', 4);
    const times = [0, 2, 4, 4, 6, 8, 8],
      now = () => times.shift() ?? 8;
    const install = function* (count: number) {
      for (let i = 0; i < count; i++) {
        steps.push(i);
        if (i < count - 1) yield;
      }
    };

    // Act
    const first = queue.drainSteps(install, now);
    const second = queue.drainSteps(install, now);

    // Assert
    expect(first).toEqual({ completed: 0, steps: 2, installMs: 4 });
    expect(second).toEqual({ completed: 1, steps: 2, installMs: 4 });
    expect(steps).toEqual([0, 1, 2, 3]);
    expect(queue.size).toBe(0);
  });
  it('подготавливает квартал под машиной и не выходит за пределы мира', () => {
    // Arrange / Act
    const result = desiredChunks({ x: 2490, y: 0, z: 2490 }, 0, 'high');
    // Assert
    expect(result.find((c) => c.key === '9,9')?.lod).toBe(0);
    expect(
      result.every((c) => {
        const [x, z] = c.key.split(',').map(Number);
        return x >= -10 && x < 10 && z >= -10 && z < 10;
      }),
    ).toBe(true);
  });
  it('генерирует совпадающие высоты на соседних границах', () => {
    // Arrange
    const w = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: {
        width: 2,
        size: 5600,
        values: new Float32Array([0, 20, 40, 60]),
      },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const a = buildChunk(w, '0,0', 0),
      b = buildChunk(w, '1,0', 0);
    const border = (positions: number[]) => {
      const list = [];
      for (let i = 0; i < positions.length; i += 3)
        if (positions[i] === 250)
          list.push([positions[i + 2], positions[i + 1]]);
      return list.sort((a, b) => a[0] - b[0]);
    };
    // Assert
    expect(border(a.terrain.positions)).toEqual(border(b.terrain.positions));
  });
  it('не создаёт горизонтальные ступени на наклонном дорожном полотне', () => {
    // Arrange
    const points = Array.from({ length: 11 }, (_, i) => ({
      x: 100,
      y: i + 0.12,
      z: i * 10,
    }));
    const w = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [
        {
          id: 0,
          stableId: '1/1/2/0',
          way: 1,
          from: 1,
          to: 2,
          length: 101,
          width: 7,
          lanes: 2,
          speed: 14,
          name: 'Подъём',
          bridge: false,
          tunnel: false,
          layer: 0,
          points,
          blocked: false,
        },
      ],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const road = buildChunk(w, '0,0', 0).road;
    // Assert
    for (let i = 0; i < road.positions.length; i += 3)
      expect(
        Math.abs(road.positions[i + 1] - (0.12 + road.positions[i + 2] * 0.1)),
      ).toBeLessThan(0.1);
  });
  it('подгоняет землю под локальную высоту дороги, а не под нижний конец сегмента', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Подъём',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 10, z: 120 },
      ],
      blocked: false,
    };
    const w = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: {
        width: 2,
        size: 5600,
        values: new Float32Array([10, 10, 10, 10]),
      },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const terrain = buildChunk(w, '0,0', 0).terrain.positions;
    const nearHighEnd = Array.from({ length: terrain.length / 3 }, (_, i) =>
      terrain.slice(i * 3, i * 3 + 3),
    ).filter((p) => Math.abs(p[0] - 100) < 13 && Math.abs(p[2] - 112.5) < 1);
    // Assert
    expect(Math.min(...nearHighEnd.map((p) => p[1]))).toBeGreaterThan(7);
  });
  it('не опускает открытый грунт за пределами дорожной обочины', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Улица',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: false,
    };
    const w = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: {
        width: 2,
        size: 5600,
        values: new Float32Array([10, 10, 10, 10]),
      },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const terrain = buildChunk(w, '0,0', 0).terrain.positions;
    const outsideApron = Array.from({ length: terrain.length / 3 }, (_, i) =>
      terrain.slice(i * 3, i * 3 + 3),
    ).filter((p) => Math.abs(p[0] - 112.5) < 1 && p[2] >= 25 && p[2] <= 112.5);
    // Assert
    expect(Math.min(...outsideApron.map((p) => p[1]))).toBeGreaterThan(9);
  });
  it('вырезает грунт под дорожным полотном вместо создания траншеи вокруг него', () => {
    // Arrange
    const edge = {
      id: 0,
      stableId: '1/1/2/0',
      way: 1,
      from: 1,
      to: 2,
      length: 100,
      width: 7,
      lanes: 2,
      speed: 14,
      name: 'Улица',
      bridge: false,
      tunnel: false,
      layer: 0,
      points: [
        { x: 100, y: 0, z: 20 },
        { x: 100, y: 0, z: 120 },
      ],
      blocked: false,
    };
    const w = {
      center: { lat: 0, lon: 0 },
      nodes: [],
      edges: [edge],
      restrictions: [],
      buildings: [],
      areas: [],
      trees: [],
      elevation: {
        width: 2,
        size: 5600,
        values: new Float32Array([10, 10, 10, 10]),
      },
      drivingSide: 'right',
      warnings: [],
      spawnEdge: null,
      routes: [],
    } as World;
    // Act
    const terrain = buildChunk(w, '0,0', 0).terrain,
      point = { x: 101, y: 0, z: 71 };
    const covers = Array.from({ length: terrain.indices.length / 3 }, (_, i) =>
      terrain.indices.slice(i * 3, i * 3 + 3).map((id) => ({
        x: terrain.positions[id * 3],
        y: 0,
        z: terrain.positions[id * 3 + 2],
      })),
    ).some((triangle) => polygonContains(point, triangle));
    // Assert
    expect(covers).toBe(false);
  });
});
