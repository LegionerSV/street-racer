import { expect, it, vi } from 'vitest';
import { Game } from './runtime';
import { buildWorld, createRaceRoute } from './network';
import { raceGrid } from './fixtures/race-grid';
import type { Route } from './types';
import { edgeById, edgeStableId } from './road-graph';

function gameFixture() {
  const world = buildWorld(raceGrid(4, 3));
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    world,
    paused: false,
    loading: false,
    suspendPump: false,
    preparingRace: false,
    race: null,
    disposed: false,
    clearControls: vi.fn(),
    emit: vi.fn(),
    refreshWanted: vi.fn(),
    player: { reset: vi.fn() },
    traffic: { startRace: vi.fn() },
    worker: { raceRoute: vi.fn() },
  });
  return game;
}
it('при старте запрашивает новый маршрут в worker и передаёт один результат игроку и соперникам', async () => {
  // Arrange
  const before = buildWorld(raceGrid()),
    invitation = before.routes.find((r) => r.kind === 'sprint')!;
  const start = edgeById(before, invitation.edges[0])!,
    game = gameFixture();
  const current = game.world.edges.find(
    (e: typeof start) =>
      e.way === start.way && e.from === start.from && e.to === start.to,
  )!;
  const stale = {
    ...invitation,
    edges: [edgeStableId(current), ...invitation.edges.slice(1)],
  };
  const fresh = createRaceRoute(game.world, edgeStableId(current), 'sprint')!;
  let finish!: (route: Route) => void;
  game.worker.raceRoute.mockImplementation(
    () =>
      new Promise<Route>((resolve) => {
        finish = resolve;
      }),
  );
  // Act
  const request = game.startRace(stale);
  await game.startRace(stale);
  // Assert — повторное нажатие не создаёт второй запрос, отсчёт ещё не начался.
  expect(game.preparingRace).toBe(true);
  expect(game.loading).toBe(true);
  expect(game.race).toBeNull();
  expect(game.worker.raceRoute).toHaveBeenCalledExactlyOnceWith(
    edgeStableId(start),
    'sprint',
  );
  // Act
  finish(fresh);
  await request;
  // Assert
  expect(game.race.route).toBe(fresh);
  expect(game.race.route.length).toBeGreaterThan(invitation.length);
  expect(game.traffic.startRace).toHaveBeenCalledWith(fresh);
  expect(game.player.reset).toHaveBeenCalledWith(current, 'right', 2);
  expect(game.preparingRace).toBe(false);
  expect(game.refreshWanted).toHaveBeenCalled();
});
it.each(['paused', 'disposed'])(
  'не запускает заезд, если во время расчёта изменилось состояние %s',
  async (state) => {
    // Arrange
    const game = gameFixture(),
      route = game.world.routes[0];
    game.worker.raceRoute.mockImplementation(async () => {
      game[state] = true;
      return route;
    });
    // Act
    await game.startRace(route);
    // Assert
    expect(game.race).toBeNull();
    expect(game.traffic.startRace).not.toHaveBeenCalled();
    expect(game.preparingRace).toBe(false);
  },
);
it('сообщает об отсутствии готового маршрута и не использует старую трассу', async () => {
  // Arrange
  const game = gameFixture();
  game.worker.raceRoute.mockResolvedValue(null);
  // Act
  await game.startRace(game.world.routes[0]);
  // Assert
  expect(game.race).toBeNull();
  expect(game.paused).toBe(true);
  expect(game.preparingRace).toBe(false);
  expect(game.message).toBe(
    'Для этого заезда пока не хватает связанных загруженных дорог. Попробуйте другой старт или дождитесь подгрузки карты.',
  );
});
