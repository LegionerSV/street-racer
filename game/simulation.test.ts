import { describe, expect, it } from 'vitest';
import { signalPhase, desiredSpeed, advanceRace, raceProgress, makeRace } from './simulation';
import type { Route } from './types';

describe('Транспорт и заезды', () => {
  it('никогда не открывает конфликтующие направления одновременно', () => {
    // Arrange / Act / Assert
    for (let t = 0; t < 200; t += .1) expect(signalPhase(t, 0) === 'green' && signalPhase(t, 1) === 'green').toBe(false);
  });
  it('останавливает трафик перед красным и перед близкой машиной', () => {
    // Arrange / Act
    const red = desiredSpeed(14, 1, 100), close = desiredSpeed(14, Infinity, 2);
    // Assert
    expect(red).toBe(0); expect(close).toBe(0); expect(desiredSpeed(14, Infinity, Infinity)).toBe(14);
  });
  it('не засчитывает пропущенные контрольные точки и завершает три круга', () => {
    // Arrange
    const route: Route = { id: 'ring', kind: 'circuit', title: 'Кольцо', edges: [], points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 0, z: 100 }, { x: 0, y: 0, z: 0 }], cumulative: [0, 100, 200, 341.42], length: 341.42, laps: 3 };
    const race = makeRace(route); race.phase = 'running';
    // Act
    advanceRace(race, route.points[2], .1);
    // Assert
    expect(race.checkpoint).toBe(1);
    // Act
    for (let lap = 0; lap < 3; lap++) for (let i = 1; i < route.points.length; i++) advanceRace(race, route.points[i], 1);
    // Assert
    expect(race.phase).toBe('finished'); expect(race.finishTime).toBeCloseTo(9.1);
  });
  it('учитывает круг и пройденное расстояние при определении позиции', () => {
    // Arrange / Act / Assert
    expect(raceProgress(2, 20, 100)).toBeGreaterThan(raceProgress(1, 99, 100));
  });
});
