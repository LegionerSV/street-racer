import {
  latLonToSourceTile,
  sourceTileKey,
  type SourceTileId,
} from '../game/source-tiles';

export type PilotName = 'moscow' | 'saint-petersburg';
export type PilotScenario =
  | 'bridge'
  | 'tunnel'
  | 'water'
  | 'interchange'
  | 'dense';

type PilotDefinition = {
  title: string;
  center: { lat: number; lon: number };
  datasetId: string;
  pbf: {
    file: string;
    source: string;
    timestamp: string;
    checksum: `md5:${string}`;
    license: 'ODbL-1.0';
  };
  specialCells: {
    title: string;
    center: { lat: number; lon: number };
    scenarios: PilotScenario[];
  }[];
};

export const MAP_PILOT_CONFIG: {
  schemaVersion: 1;
  zoom: 15;
  width: 10;
  height: 10;
  concurrency: 4;
  generatedAt: string;
  dem: { timestamp: string; license: string };
  pilots: Record<PilotName, PilotDefinition>;
} = {
  schemaVersion: 1,
  zoom: 15,
  width: 10,
  height: 10,
  concurrency: 4,
  generatedAt: '2026-09-11T14:05:34.000Z',
  dem: {
    timestamp: '2026-09-11T00:00:00.000Z',
    license: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
  pilots: {
    moscow: {
      title: 'Москва',
      center: { lat: 55.751244, lon: 37.618423 },
      datasetId: 'moscow-pilot-20260911',
      pbf: {
        file: 'moscow-2026-09-11.osm.pbf',
        source:
          'https://download.openstreetmap.fr/extracts/russia/central_federal_district/moscow.osm.pbf',
        timestamp: '2026-09-11T00:32:57.000Z',
        checksum: 'md5:764cc772bc3dba1e97f3fdc8094bfa11',
        license: 'ODbL-1.0',
      },
      specialCells: [
        {
          title: 'Большой Каменный мост и Москва-река',
          center: { lat: 55.745, lon: 37.6135 },
          scenarios: ['bridge', 'water'],
        },
        {
          title: 'Лефортовский тоннель и Третье транспортное кольцо',
          center: { lat: 55.755567, lon: 37.690668 },
          scenarios: ['tunnel'],
        },
        {
          title: 'Москва-Сити',
          center: { lat: 55.7497, lon: 37.5377 },
          scenarios: ['dense'],
        },
        {
          title: 'Развязка МКАД и Варшавского шоссе',
          center: { lat: 55.574527, lon: 37.600829 },
          scenarios: ['interchange'],
        },
      ],
    },
    'saint-petersburg': {
      title: 'Санкт-Петербург',
      center: { lat: 59.9343, lon: 30.3351 },
      datasetId: 'saint-petersburg-pilot-20260911',
      pbf: {
        file: 'saint-petersburg-2026-09-11.osm.pbf',
        source:
          'https://download.openstreetmap.fr/extracts/russia/northwestern_federal_district/saint_petersburg.osm.pbf',
        timestamp: '2026-09-11T00:30:01.000Z',
        checksum: 'md5:348d20738b783edc6b26deab89636fe8',
        license: 'ODbL-1.0',
      },
      specialCells: [
        {
          title: 'Биржевой и Дворцовый мосты, Нева и плотный центр',
          center: { lat: 59.944, lon: 30.31 },
          scenarios: ['bridge', 'water', 'dense'],
        },
        {
          title: 'Большеохтинский мост',
          center: { lat: 59.9425, lon: 30.4015 },
          scenarios: ['bridge', 'water'],
        },
        {
          title: 'Канонерский тоннель',
          center: { lat: 59.903775, lon: 30.225038 },
          scenarios: ['tunnel'],
        },
        {
          title: 'Тоннель ЗСД',
          center: { lat: 59.9514, lon: 30.2065 },
          scenarios: ['tunnel'],
        },
        {
          title: 'Развязка КАД, Таллинского шоссе и ЗСД',
          center: { lat: 59.835068, lon: 30.27979 },
          scenarios: ['interchange'],
        },
      ],
    },
  },
};

export function pilotAdditionalTiles(name: PilotName): SourceTileId[] {
  const unique = new Map<string, SourceTileId>();
  for (const cell of MAP_PILOT_CONFIG.pilots[name].specialCells) {
    const tile = latLonToSourceTile(
      cell.center.lat,
      cell.center.lon,
      MAP_PILOT_CONFIG.zoom,
    );
    unique.set(sourceTileKey(tile), tile);
  }
  return [...unique.values()];
}
