import { describe, it, expect } from 'vitest';
import { buildWorld, outgoing, allowedTurn, createRoutes, advanceTurnHistory } from './network';
import type { RegionData, OSMElement } from './types';

const node = (id: number, lon: number, lat: number, signal = false): OSMElement => ({ type: 'node', id, lon, lat, tags: signal ? { highway: 'traffic_signals' } : {} });
const road = (id: number, nodes: number[], tags = {}): OSMElement => ({ type: 'way', id, nodes, tags: { highway: 'residential', ...tags } });
const region = (elements: OSMElement[]): RegionData => ({ center: { lat: 0, lon: 0 }, elements, elevation: { size: 5600, width: 2, values: new Float32Array(4) }, fetchedAt: '2026-09-05', drivingSide: 'right' });

describe('Дорожная сеть', () => {
  it('сохраняет запрет поворота через промежуточную дорогу только для нужного въезда', () => {
    // Arrange
    const input = region([node(1, -.003, 0), node(2, 0, 0), node(3, .003, 0), node(4, .003, .003), node(5, .003, -.003), road(10, [1, 2]), road(11, [2, 3]), road(12, [3, 4]), road(13, [3, 5]), { type: 'relation', id: 99, tags: { type: 'restriction', restriction: 'no_left_turn' }, members: [{ type: 'way', role: 'from', ref: 10 }, { type: 'way', role: 'via', ref: 11 }, { type: 'way', role: 'to', ref: 12 }] }]);
    const w = buildWorld(input), from = w.edges.find(e => e.from === 1)!, via = w.edges.find(e => e.from === 2 && e.to === 3)!;
    // Act
    const history = advanceTurnHistory(w, advanceTurnHistory(w, [], from.way), via.way);
    // Assert
    expect(allowedTurn(w, via, w.edges.find(e => e.from === 3 && e.to === 4)!, history)).toBe(false);
    expect(allowedTurn(w, via, w.edges.find(e => e.from === 3 && e.to === 5)!, history)).toBe(true);
    expect(allowedTurn(w, via, w.edges.find(e => e.from === 3 && e.to === 4)!, [])).toBe(true);
  });
  it('сохраняет одностороннее движение и не соединяет пересечение под мостом', () => {
    // Arrange
    const input = region([node(1, -.003, 0), node(2, .003, 0), node(3, 0, -.003), node(4, 0, .003), road(10, [1, 2], { oneway: 'yes' }), road(11, [3, 4], { bridge: 'yes', layer: '1' })]);
    // Act
    const w = buildWorld(input);
    // Assert
    expect(w.edges.filter(e => e.way === 10)).toHaveLength(1);
    expect(outgoing(w, 2).filter(e => e.way === 11)).toHaveLength(0);
    const bridge = w.edges.find(e => e.way === 11)!;
    expect(Math.max(...bridge.points.map(p => p.y))).toBeGreaterThan(5);
  });
  it('соблюдает запрет и обязательное направление поворота', () => {
    // Arrange
    const input = region([node(1, -.003, 0), node(2, 0, 0), node(3, .003, 0), node(4, 0, .003), road(10, [1, 2]), road(11, [2, 3]), road(12, [2, 4]), { type: 'relation', id: 99, tags: { type: 'restriction', restriction: 'only_straight_on' }, members: [{ type: 'way', role: 'from', ref: 10 }, { type: 'node', role: 'via', ref: 2 }, { type: 'way', role: 'to', ref: 11 }] }]);
    // Act
    const w = buildWorld(input), incoming = w.edges.find(e => e.from === 1)!;
    // Assert
    expect(allowedTurn(w, incoming, w.edges.find(e => e.from === 2 && e.to === 3)!)).toBe(true);
    expect(allowedTurn(w, incoming, w.edges.find(e => e.from === 2 && e.to === 4)!)).toBe(false);
  });
  it('строит кольцо только из замкнутой связной сети', () => {
    // Arrange
    const input = region([node(1, -.008, -.008), node(2, .008, -.008), node(3, .008, .008), node(4, -.008, .008), road(10, [1, 2, 3, 4, 1], { oneway: 'yes' })]);
    // Act
    const w = buildWorld(input), routes = createRoutes(w);
    // Assert
    const ring = routes.find(r => r.kind === 'circuit');
    expect(ring).toBeDefined(); expect(ring!.laps).toBe(3);
    expect(ring!.length).toBeGreaterThan(6000);
  });
  it('не принимает дорогу без достаточной длины за полноценный район', () => {
    // Arrange
    const input = region([node(1, 0, 0), node(2, .00001, 0), road(10, [1, 2])]);
    // Act
    const w = buildWorld(input);
    // Assert
    expect(w.warnings).toContain('Недостаточно связанных дорог для заезда. Выберите другой участок.');
  });
  it('держит весь тоннель вместе с порталами под рельефом', () => {
    // Arrange
    const input = region([node(1, -.004, 0), node(2, .004, 0), road(10, [1, 2], { tunnel: 'yes', layer: '-1' })]);
    // Act
    const w = buildWorld(input), e = w.edges[0];
    // Assert
    expect(e.points[0].y + 5.7).toBeLessThan(-.5);
    expect(e.points.at(-1)!.y).toBeCloseTo(e.points[0].y, 6);
    expect(e.points[0].y).toBeCloseTo(w.nodes.find(n=>n.id===e.from)!.y, 6);
    expect(Math.min(...e.points.map(p => p.y))).toBeLessThan(-5);
    expect(e.blocked).toBe(false);
  });
  it('запрет разворота не запрещает продолжать движение по той же улице', () => {
    // Arrange
    const input = region([node(1, -.003, 0), node(2, 0, 0), node(3, .003, 0), road(10, [1, 2, 3]), { type: 'relation', id: 99, tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [{ type: 'way', role: 'from', ref: 10 }, { type: 'node', role: 'via', ref: 2 }, { type: 'way', role: 'to', ref: 10 }] }]);
    // Act
    const w = buildWorld(input), incoming = w.edges.find(e => e.from === 1)!;
    // Assert
    expect(allowedTurn(w, incoming, w.edges.find(e => e.from === 2 && e.to === 3)!)).toBe(true);
    expect(allowedTurn(w, incoming, w.edges.find(e => e.from === 2 && e.to === 1)!)).toBe(false);
  });
});
