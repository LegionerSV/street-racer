import { expect, it } from 'vitest';
import { validateClearance, fitBridgeClearance, roadCrossings, crossingClearance } from './clearance';
import type { Edge } from './types';

const road = (id: number, points: Edge['points'], bridge = false): Edge => ({ id, way: id, from: id * 2, to: id * 2 + 1, points, bridge, tunnel: false, layer: bridge ? 1 : 0, width: 7, lanes: 2, length: 100, speed: 15, name: 'Дорога', blocked: false });

it('закрывает оба направления моста при недостаточном просвете', () => {
  // Arrange
  const lower = road(1, [{ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }]);
  const upper = road(2, [{ x: 0, y: 3, z: -50 }, { x: 0, y: 3, z: 50 }], true);
  const reverse = { ...upper, id: 3, from: upper.to, to: upper.from, points: [...upper.points].reverse() };
  // Act
  const warnings = validateClearance([lower, upper, reverse]);
  // Assert
  expect(lower.blocked).toBe(false); expect(upper.blocked).toBe(true); expect(reverse.blocked).toBe(true);
  expect(warnings).toEqual(['Дорога 2 закрыта: недостаточный просвет между уровнями.']);
});

it('сохраняет проезд с просветом 6,5 м и не проверяет съезд как пересечение', () => {
  // Arrange
  const lower = road(1, [{ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }]);
  const upper = road(2, [{ x: 0, y: 6.5, z: -50 }, { x: 0, y: 6.5, z: 50 }], true);
  // Act
  const warnings = validateClearance([lower, upper]);
  // Assert
  expect(warnings).toEqual([]); expect(upper.blocked).toBe(false);
});

it('проверяет низ плиты, в том числе края косой дороги и параллельное перекрытие',()=>{
  // Arrange
  const lower=road(1,[{x:-40,y:0,z:0},{x:40,y:1,z:30}]);lower.width=14;
  const upper=road(2,[{x:-30,y:1,z:9},{x:30,y:2,z:9}],true);
  // Act
  const edges=[lower,upper];fitBridgeClearance(edges);const contacts=roadCrossings(edges);
  // Assert
  expect(contacts.length).toBeGreaterThan(4);
  for(const c of contacts)expect(crossingClearance(c)).toBeGreaterThanOrEqual(3.5);
  expect(validateClearance(edges)).toEqual([]);
});

it('нижний мост учитывается до верхнего, номер слоя не становится множителем высоты',()=>{
  // Arrange
  const ground=road(1,[{x:-50,y:0,z:0},{x:50,y:0,z:0}]);
  const middle=road(2,[{x:0,y:0,z:-50},{x:0,y:0,z:50}],true);
  const top=road(3,[{x:-50,y:0,z:0},{x:50,y:0,z:0}],true);top.layer=5;
  // Act
  const edges=[top,ground,middle];fitBridgeClearance(edges);
  // Assert
  for(const c of roadCrossings(edges))expect(crossingClearance(c)).toBeGreaterThanOrEqual(3.5);
  expect(top.points[0].y).toBeLessThan(9);
});
