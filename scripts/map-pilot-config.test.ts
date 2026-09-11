import { expect, it } from 'vitest';
import { generateMapTiles, type GeneratorEvent } from './generate-map-tiles';
import {
  MAP_PILOT_CONFIG,
  pilotAdditionalTiles,
  type PilotName,
} from './map-pilot-config';

it.each([
  ['moscow', 103],
  ['saint-petersburg', 104],
] as const)('строит воспроизводимый план пилота %s', async (name, planned) => {
  // Arrange
  const pilot = MAP_PILOT_CONFIG.pilots[name],
    events: GeneratorEvent[] = [];

  // Act
  const report = await generateMapTiles(
    {
      staging: `work/map-pilots/${name}`,
      center: pilot.center,
      width: MAP_PILOT_CONFIG.width,
      height: MAP_PILOT_CONFIG.height,
      zoom: MAP_PILOT_CONFIG.zoom,
      additionalTiles: pilotAdditionalTiles(name),
      concurrency: MAP_PILOT_CONFIG.concurrency,
      dryRun: true,
    },
    (event) => events.push(event),
  );

  // Assert
  expect(report).toMatchObject({ planned, generated: 0, failed: [] });
  expect(events[0]).toMatchObject({ kind: 'plan', count: planned });
});

it('покрывает специальными клетками все обязательные сценарии', () => {
  // Arrange
  const required = ['bridge', 'tunnel', 'water', 'interchange', 'dense'];

  // Act
  const covered = new Set(
    (Object.keys(MAP_PILOT_CONFIG.pilots) as PilotName[]).flatMap((name) =>
      MAP_PILOT_CONFIG.pilots[name].specialCells.flatMap(
        (cell) => cell.scenarios,
      ),
    ),
  );

  // Assert
  expect([...covered].sort()).toEqual(required.sort());
  expect(
    pilotAdditionalTiles('moscow').map(({ z, x, y }) => `${z}/${x}/${y}`),
  ).toEqual([
    '15/19807/10245',
    '15/19814/10243',
    '15/19800/10244',
    '15/19806/10272',
  ]);
  expect(
    pilotAdditionalTiles('saint-petersburg').map(
      ({ z, x, y }) => `${z}/${x}/${y}`,
    ),
  ).toEqual([
    '15/19142/9526',
    '15/19151/9526',
    '15/19135/9533',
    '15/19133/9524',
    '15/19140/9545',
  ]);
});
