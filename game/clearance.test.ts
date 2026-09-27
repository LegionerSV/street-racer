import { expect, it } from 'vitest';
import {
  validateClearance,
  fitBridgeClearance,
  fitTunnelDepth,
  roadCrossings,
  crossingClearance,
} from './clearance';
import type { Edge } from './types';

const road = (id: number, points: Edge['points'], bridge = false): Edge => ({
  id,
  stableId: `${id}/${id * 2}/${id * 2 + 1}/0`,
  way: id,
  from: id * 2,
  to: id * 2 + 1,
  points,
  bridge,
  tunnel: false,
  layer: bridge ? 1 : 0,
  width: 7,
  lanes: 2,
  length: 100,
  speed: 15,
  name: 'Дорога',
  blocked: false,
});

it('подъём верхней эстакады не подтягивает пересекающий её нижний съезд', () => {
  // Arrange
  const upper = {
    ...road(
      1,
      Array.from({ length: 19 }, (_, i) => ({ x: -60 + i * 10, y: 0, z: 0 })),
      true,
    ),
    layer: 2,
    from: 1,
    to: 2,
  };
  const approach = {
    ...road(
      4,
      [
        { x: -60, y: 0, z: 0 },
        { x: -30, y: 0, z: -20 },
        { x: 0, y: 0, z: -20 },
      ],
      true,
    ),
    layer: 1,
    from: 1,
    to: 4,
  };
  const lower = {
    ...road(
      2,
      [
        { x: 0, y: 0, z: -20 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 20 },
        { x: 0, y: 0, z: 50 },
      ],
      true,
    ),
    layer: 1,
    from: 4,
    to: 3,
  };
  const reverse = {
    ...lower,
    id: 3,
    from: 3,
    to: 4,
    points: [...lower.points].reverse(),
  };
  // Act
  fitBridgeClearance([upper, approach, lower, reverse]);
  // Assert
  const crossings = roadCrossings([upper, lower]);
  expect(crossings.length).toBeGreaterThan(0);
  expect(
    crossings.every((crossing) => crossingClearance(crossing) >= 3.5 - 0.02),
  ).toBe(true);
  expect(validateClearance([upper, approach, lower, reverse])).toEqual([]);
  expect(approach.points[0].y).toBeCloseTo(upper.points[0].y, 8);
  expect(approach.points.at(-1)!.y).toBeCloseTo(lower.points[0].y, 8);
  expect(reverse.points.map((point) => point.y)).toEqual(
    lower.points.map((point) => point.y).reverse(),
  );
});

it('съезд другой категории сохраняет плавный переход с верхней магистрали на нижний уровень', () => {
  // Arrange
  const upper = {
    ...road(
      1,
      Array.from({ length: 31 }, (_, i) => ({ x: -150 + i * 10, y: 0, z: 0 })),
      true,
    ),
    layer: 2,
    from: 1,
    to: 2,
    category: 'motorway',
  };
  const ramp = {
    ...road(
      2,
      Array.from({ length: 31 }, (_, i) => ({ x: -150 + i * 5, y: 0, z: -i })),
      true,
    ),
    layer: 2,
    from: 1,
    to: 3,
    category: 'primary',
  };
  const lower = {
    ...road(
      3,
      Array.from({ length: 21 }, (_, i) => ({ x: 0, y: 0, z: -30 + i * 5 })),
      true,
    ),
    layer: 1,
    from: 3,
    to: 4,
    category: 'primary',
  };
  const ground = road(4, [
    { x: 100, y: 10, z: -50 },
    { x: 100, y: 10, z: 50 },
  ]);
  // Act
  fitBridgeClearance([upper, ramp, lower, ground]);
  // Assert
  expect(validateClearance([upper, ramp, lower, ground])).toEqual([]);
  expect(ramp.points[0].y).toBeCloseTo(upper.points[0].y, 8);
  expect(ramp.points.at(-1)!.y).toBeCloseTo(lower.points[0].y, 8);
  for (const edge of [ramp, lower])
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1],
        b = edge.points[i];
      expect(
        Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z),
      ).toBeLessThan(0.2);
    }
});

it('заглубление тоннеля не тянет соседний мост и его торец под воду', () => {
  // Arrange
  const tunnel = {
    ...road(1, [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ]),
    from: 1,
    to: 2,
    tunnel: true,
    layer: -1,
  };
  const approach = {
    ...road(2, [
      { x: 100, y: 0, z: 0 },
      { x: 200, y: 0, z: 0 },
    ]),
    from: 2,
    to: 3,
  };
  const bridge = {
    ...road(
      3,
      [
        { x: 200, y: 0, z: 0 },
        { x: 250, y: 0, z: 0 },
      ],
      true,
    ),
    from: 3,
    to: 4,
  };
  const elevation = { width: 2, size: 1000, values: new Float32Array(4) };
  // Act
  fitTunnelDepth([tunnel, approach, bridge], elevation);
  // Assert
  expect(tunnel.points[0].y).toBeLessThan(-6);
  expect(bridge.points.every((point) => point.y === 0)).toBe(true);
  expect(approach.points.at(-1)!.y).toBeCloseTo(bridge.points[0].y, 6);
});

it('короткий подход от моста плавно входит в тоннель без потери глубины внутри', () => {
  // Arrange
  const bridge = {
    ...road(
      1,
      [
        { x: 0, y: 0, z: 0 },
        { x: 50, y: 0, z: 0 },
      ],
      true,
    ),
    from: 1,
    to: 2,
  };
  const approach = {
    ...road(2, [
      { x: 50, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ]),
    from: 2,
    to: 3,
  };
  const tunnel = {
    ...road(3, [
      { x: 100, y: 0, z: 0 },
      { x: 150, y: 0, z: 0 },
      { x: 200, y: 0, z: 0 },
    ]),
    from: 3,
    to: 4,
    tunnel: true,
    layer: -1,
  };
  const elevation = { width: 2, size: 1000, values: new Float32Array(4) };
  // Act
  fitTunnelDepth([bridge, approach, tunnel], elevation);
  // Assert
  expect(bridge.points.every((point) => point.y === 0)).toBe(true);
  expect(approach.points[0].y).toBeCloseTo(bridge.points.at(-1)!.y, 6);
  expect(tunnel.points[0].y).toBeCloseTo(approach.points.at(-1)!.y, 6);
  expect(tunnel.points[1].y).toBeLessThan(-6);
});

it('не превращает примыкающую магистраль в подход к безымянному тоннелю', () => {
  // Arrange.
  const tunnel = {
    ...road(1, [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ]),
    from: 1,
    to: 2,
    name: 'Безымянная улица',
    category: 'service',
    tunnel: true,
    layer: -1,
  };
  const approach = {
    ...road(2, [
      { x: 100, y: 0, z: 0 },
      { x: 200, y: 0, z: 0 },
    ]),
    from: 2,
    to: 3,
    name: 'Безымянная улица',
    category: 'service',
  };
  const avenue = {
    ...road(3, [
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, z: 150 },
    ]),
    from: 2,
    to: 4,
    name: 'Театральный проезд',
    category: 'primary',
  };
  const elevation = {
    width: 2,
    size: 1000,
    values: new Float32Array(4),
  };
  // Act.
  fitTunnelDepth([tunnel, approach, avenue], elevation);
  // Assert.
  expect(approach.tunnelApproach).toBe(true);
  expect(approach.points[0].y).toBeLessThan(-6);
  expect(avenue.tunnelApproach).not.toBe(true);
  expect(avenue.points.every((point) => point.y === 0)).toBe(true);
});

it('сшивает единственный поворачивающий подъезд с порталом тоннеля', () => {
  // Arrange.
  const tunnel = {
    ...road(1, [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ]),
    from: 1,
    to: 2,
    tunnel: true,
    layer: -1,
  };
  const approach = {
    ...road(2, [
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, z: 120 },
    ]),
    from: 2,
    to: 3,
  };
  const elevation = { width: 2, size: 1000, values: new Float32Array(4) };
  // Act.
  fitTunnelDepth([tunnel, approach], elevation);
  // Assert.
  expect(approach.tunnelApproach).toBe(true);
  expect(approach.points[0].y).toBeCloseTo(tunnel.points.at(-1)!.y, 6);
  expect(approach.points.at(-1)!.y).toBeGreaterThan(approach.points[0].y);
});

it('закрывает оба направления моста при недостаточном просвете', () => {
  // Arrange
  const lower = road(1, [
    { x: -50, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
  const upper = road(
    2,
    [
      { x: 0, y: 3, z: -50 },
      { x: 0, y: 3, z: 50 },
    ],
    true,
  );
  const reverse = {
    ...upper,
    id: 3,
    from: upper.to,
    to: upper.from,
    points: [...upper.points].reverse(),
  };
  // Act
  const warnings = validateClearance([lower, upper, reverse]);
  // Assert
  expect(lower.blocked).toBe(false);
  expect(upper.blocked).toBe(true);
  expect(reverse.blocked).toBe(true);
  expect(warnings).toEqual([
    'Дорога 2 закрыта: недостаточный просвет между уровнями.',
  ]);
});

it('не закрывает плоский въезд на мост из соседнего полотна без общего OSM-узла', () => {
  // Arrange
  const approach = road(1, [
    { x: 4, y: 0, z: -40 },
    { x: 4, y: 0, z: 0 },
  ]);
  const bridge = road(
    2,
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 20 },
    ],
    true,
  );
  // Act
  const warnings = validateClearance([approach, bridge]);
  // Assert
  expect(warnings).toEqual([]);
  expect(bridge.blocked).toBe(false);
});

it('поднимает верхний мост над торцом нижней эстакады даже при одинаковой исходной высоте', () => {
  // Arrange
  const lower = road(
    1,
    [
      { x: -20, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    true,
  );
  const upper = road(
    2,
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 40 },
    ],
    true,
  );
  lower.layer = 1;
  upper.layer = 2;
  // Act
  fitBridgeClearance([lower, upper]);
  const crossings = roadCrossings([lower, upper]);
  // Assert
  expect(crossings.length).toBeGreaterThan(0);
  expect(crossings.every((c) => crossingClearance(c) >= 3.5)).toBe(true);
  expect(validateClearance([lower, upper])).toEqual([]);
});

it('не закрывает соседнее полотно Московского проспекта у Ново-Московского моста', () => {
  // Arrange — координаты из отчёта о производительности у въезда на мост.
  const avenue = road(762292234, [
    { x: 23.395, y: -8.018, z: -171.942 },
    { x: 23.365, y: -8.031, z: -163.055 },
  ]);
  avenue.width = 14;
  const bridge = road(
    28678607,
    [
      { x: 23.831, y: -8.018, z: -185.601 },
      { x: 25.095, y: -8.014, z: -183.672 },
      { x: 26.36, y: -7.97, z: -181.743 },
      { x: 27.624, y: -7.908, z: -179.814 },
      { x: 28.889, y: -7.849, z: -177.885 },
      { x: 30.153, y: -7.827, z: -175.956 },
      { x: 31.418, y: -7.954, z: -174.027 },
      { x: 32.682, y: -8.018, z: -172.098 },
    ],
    true,
  );
  bridge.width = 7;
  // Act
  const warnings = validateClearance([avenue, bridge]);
  // Assert
  expect(warnings).toEqual([]);
  expect(bridge.blocked).toBe(false);
});

it('продолжает закрывать реальный недостаточный просвет в середине моста', () => {
  // Arrange
  const lower = road(1, [
    { x: -50, y: 0, z: 50 },
    { x: 50, y: 0, z: 50 },
  ]);
  const bridge = road(
    2,
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 100 },
    ],
    true,
  );
  // Act
  const warnings = validateClearance([lower, bridge]);
  // Assert
  expect(warnings).toEqual([
    'Дорога 2 закрыта: недостаточный просвет между уровнями.',
  ]);
  expect(bridge.blocked).toBe(true);
});

it('сохраняет проезд с просветом 6,5 м и не проверяет съезд как пересечение', () => {
  // Arrange
  const lower = road(1, [
    { x: -50, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
  const upper = road(
    2,
    [
      { x: 0, y: 6.5, z: -50 },
      { x: 0, y: 6.5, z: 50 },
    ],
    true,
  );
  // Act
  const warnings = validateClearance([lower, upper]);
  // Assert
  expect(warnings).toEqual([]);
  expect(upper.blocked).toBe(false);
});

it('проверяет низ плиты, в том числе края косой дороги и параллельное перекрытие', () => {
  // Arrange
  const lower = road(1, [
    { x: -40, y: 0, z: 0 },
    { x: 40, y: 1, z: 30 },
  ]);
  lower.width = 14;
  const upper = road(
    2,
    [
      { x: -30, y: 1, z: 9 },
      { x: 30, y: 2, z: 9 },
    ],
    true,
  );
  // Act
  const edges = [lower, upper];
  fitBridgeClearance(edges);
  const contacts = roadCrossings(edges);
  // Assert
  expect(contacts.length).toBeGreaterThan(4);
  for (const c of contacts)
    expect(crossingClearance(c)).toBeGreaterThanOrEqual(3.5);
  expect(validateClearance(edges)).toEqual([]);
});

it('не закрывает конструкцию из-за сантиметровой погрешности и очищает старую блокировку', () => {
  // Arrange
  const lower = road(1, [
    { x: -50, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
  const upper = road(
    2,
    [
      { x: 0, y: 3.49 + 0.55, z: -50 },
      { x: 0, y: 3.49 + 0.55, z: 50 },
    ],
    true,
  );
  upper.blocked = true;
  upper.blockedReasons = ['clearance'];
  // Act
  const warnings = validateClearance([lower, upper]);
  // Assert
  expect(warnings).toEqual([]);
  expect(upper.blocked).toBe(false);
  expect(upper.clearanceIssue).toBeUndefined();
});

it('нижний мост учитывается до верхнего, номер слоя не становится множителем высоты', () => {
  // Arrange
  const ground = road(1, [
    { x: -50, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
  const middle = road(
    2,
    [
      { x: 0, y: 0, z: -50 },
      { x: 0, y: 0, z: 50 },
    ],
    true,
  );
  const top = road(
    3,
    [
      { x: -50, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 },
    ],
    true,
  );
  top.layer = 5;
  // Act
  const edges = [top, ground, middle];
  fitBridgeClearance(edges);
  // Assert
  for (const c of roadCrossings(edges))
    expect(crossingClearance(c)).toBeGreaterThanOrEqual(3.5);
  expect(top.points[0].y).toBeLessThan(9);
});

it('не закрывает весь way из-за одного конфликтующего сегмента и сохраняет другие причины', () => {
  // Arrange
  const lower = road(1, [
    { x: -50, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
  const crossing = road(
    2,
    [
      { x: 0, y: 3, z: -50 },
      { x: 0, y: 3, z: 50 },
    ],
    true,
  );
  const remote = {
    ...road(
      3,
      [
        { x: 0, y: 6, z: 200 },
        { x: 0, y: 6, z: 300 },
      ],
      true,
    ),
    way: crossing.way,
  };
  const legacy = {
    ...road(4, [
      { x: 300, y: 0, z: 0 },
      { x: 400, y: 0, z: 0 },
    ]),
    blocked: true,
  };
  // Act
  validateClearance([lower, crossing, remote, legacy]);
  // Assert
  expect(crossing.blocked).toBe(true);
  expect(remote.blocked).toBe(false);
  expect(legacy.blocked).toBe(true);
});
