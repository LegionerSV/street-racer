import { describe, expect, it } from 'vitest';
import { createRacerTraits, racerTraitWords, racingLineOffset } from './racing-ai';
import { smoothPath } from './driving-path';
import type { Edge } from './types';

const edge: Edge = { id: 0, way: 1, from: 1, to: 2, length: 120, width: 8, lanes: 2, oneWay: true, speed: 25, name: 'Поворот', bridge: false, tunnel: false, layer: 0, blocked: false, sidewalkLeft: true, sidewalkRight: true, points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 60 }, { x: 60, y: 0, z: 60 }] };

describe('характер соперника', () => {
  it('один раз задаёт непредельные точность, агрессию и реакцию', () => {
    // Arrange
    const values = [.25, .5, .75]; let index = 0;
    // Act
    const traits = createRacerTraits(() => values[index++]);
    // Assert
    expect(traits.accuracy).toBeCloseTo(.68);expect(traits.aggression).toBeCloseTo(.6);expect(traits.reaction).toBeCloseTo(.8375);
    expect(Object.values(traits).every(value => value > 0 && value < 1)).toBe(true);
    expect(racerTraitWords(traits)).toEqual(['НЕРВНЫЙ', 'НАПОРИСТЫЙ', 'МОЛНИЯ']);
  });

  it('строит линию с широким входом и внутренним апексом', () => {
    // Arrange
    const path = smoothPath(edge.points, 10), traits = { accuracy: .8, aggression: .6, reaction: .8 };
    // Act
    const entry = racingLineOffset(path, 38, edge, traits, 0), apex = racingLineOffset(path, 60, edge, traits, 0);
    // Assert — правый поворот: вход слева, апекс справа.
    expect(entry).toBeLessThan(-2);
    expect(apex).toBeGreaterThan(2);
  });
});
