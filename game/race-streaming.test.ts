import { expect, it, vi } from 'vitest';
import { Game } from './runtime';
import { criticalChunks } from './chunks';
import { makeRace } from './simulation';
import { tileReady } from './region-stream';
import { sourceTileKeysForLocalBounds } from './stream-coverage';
import type { Point, Route } from './types';

it('возвращает гонщика к контрольной точке и снимает ожидание отсутствующей карты', () => {
  // Arrange — используем игровой переход без запуска рендера и физического движка.
  const route: Route = {
    id: 'test',
    kind: 'circuit',
    title: 'Заезд',
    edges: [0],
    points: [
      { x: 500, y: 0, z: 500 },
      { x: 700, y: 0, z: 500 },
    ],
    cumulative: [0, 200],
    length: 200,
    laps: 3,
  };
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    race: makeRace(route),
    driveTest: null,
    mapCoverage: new Set(
      sourceTileKeysForLocalBounds(
        { lat: 0, lon: 0 },
        { minX: 200, minZ: 200, maxX: 800, maxZ: 800 },
      ),
    ),
    world: { center: { lat: 0, lon: 0 } },
    camera: { position: { setAll: vi.fn() } },
    clearControls: vi.fn(),
    refreshWanted: vi.fn(),
  });
  game.race.phase = 'running';
  game.race.elapsed = 12;
  game.race.lap = 2;
  game.player = {
    position: { x: 500, y: 0, z: 1200 },
    heading: 0,
    teleport(p: Point, h: number) {
      this.position = { ...p };
      this.heading = h;
    },
  };
  const before = criticalChunks(
    game.player.position,
    game.player.heading,
    true,
  );
  // Act
  const after: string[] = game.recoverAtMapBoundary(before);
  // Assert
  expect(
    before.some((k) => !tileReady(game.mapCoverage, k, game.world.center)),
  ).toBe(true);
  expect(
    after.every((k) => tileReady(game.mapCoverage, k, game.world.center)),
  ).toBe(true);
  expect(game.player.position).toEqual({ x: 500, y: 0.88, z: 500 });
  expect(game.race).toMatchObject({
    phase: 'running',
    elapsed: 12,
    lap: 2,
    checkpoint: 1,
  });
  expect(game.message).toBe(
    'Впереди район ещё не загружен. Автомобиль возвращён на трассу.',
  );
});
