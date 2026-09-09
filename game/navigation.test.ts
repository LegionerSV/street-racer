import { describe, expect, it } from 'vitest';
import { nextRaceTurn } from './navigation';
import type { RaceState } from './types';

const race = (points: RaceState['route']['points'], checkpoint = 1): RaceState => ({
  route: { id: 'test', kind: 'sprint', title: 'Тест', edges: [], points, cumulative: [], length: 200, laps: 1 },
  phase: 'running', countdown: 0, elapsed: 1, checkpoint, lap: 1, position: 1,
});

describe('Навигатор гонки', () => {
  it('заранее подсказывает левый поворот и расстояние до него', () => {
    // Arrange
    const state = race([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 80 }, { x: -80, y: 0, z: 80 }]);
    // Act
    const hint = nextRaceTurn(state, { x: 0, y: 0, z: 20 });
    // Assert
    expect(hint?.direction).toBe('left');
    expect(hint?.distance).toBeCloseTo(60, 3);
  });
  it('не показывает прямые промежуточные точки и далёкие повороты', () => {
    // Arrange
    const state = race([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 70 }, { x: 0, y: 0, z: 140 }, { x: 80, y: 0, z: 140 }]);
    // Act / Assert
    expect(nextRaceTurn(state, { x: 0, y: 0, z: 0 }, 100)).toBeNull();
    expect(nextRaceTurn(state, { x: 0, y: 0, z: 60 }, 100)?.direction).toBe('right');
  });
  it('удерживает подсказку после раннего зачёта контрольной точки до прохождения угла', () => {
    // Arrange — симуляция уже переключила checkpoint за 20 м до поворота.
    const state = race([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 80 }, { x: -80, y: 0, z: 80 }], 2);
    // Act / Assert
    expect(nextRaceTurn(state, { x: 0, y: 0, z: 62 })?.direction).toBe('left');
    expect(nextRaceTurn(state, { x: -10, y: 0, z: 80 })).toBeNull();
  });
});
