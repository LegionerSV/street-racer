export type FullCoverageName =
  | 'moscow'
  | 'saint-petersburg'
  | 'olonetsky-district';

type FullCoverageDefinition = {
  title: string;
  datasetId: string;
  concurrency: number;
  plannedTiles: number;
  estimatedBytes: { low: number; high: number };
  boundary: {
    file: string;
    source: string;
    relationId?: number;
    anchorRelationIds?: number[];
    sha256: string;
    simplificationDegrees?: number;
    bufferMeters?: number;
  };
  pbf: {
    file: string;
    source: string;
    components?: { source: string; timestamp: string }[];
    timestamp: string;
    checksum: `md5:${string}`;
    license: 'ODbL-1.0';
  };
};

export const MAP_FULL_COVERAGE_CONFIG: {
  schemaVersion: 1;
  zoom: 15;
  maxTileBytes: 4_194_304;
  generatedAt: string;
  dem: { timestamp: string; license: string };
  regions: Record<FullCoverageName, FullCoverageDefinition>;
} = {
  schemaVersion: 1,
  zoom: 15,
  maxTileBytes: 4_194_304,
  generatedAt: '2026-09-11T18:40:00.000Z',
  dem: {
    timestamp: '2026-09-11T00:00:00.000Z',
    license: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
  regions: {
    moscow: {
      title: 'Москва',
      datasetId: 'moscow-full-20260911',
      concurrency: 8,
      plannedTiles: 5_881,
      estimatedBytes: { low: 1_900_000_000, high: 2_300_000_000 },
      boundary: {
        file: 'scripts/map-coverage/moscow.geojson',
        source:
          'https://nominatim.openstreetmap.org/lookup?format=geojson&polygon_geojson=1&polygon_threshold=0.0005&osm_ids=R102269',
        relationId: 102269,
        sha256:
          'a171de9b2a310a86b5dc29aa48117d2977d4e4722845840183541fcfb16346dd',
        simplificationDegrees: 0.0005,
      },
      pbf: {
        file: 'moscow-with-oblast-2026-09-11.osm.pbf',
        source:
          'osmium merge: Moscow + Moscow Oblast extracts from download.openstreetmap.fr',
        components: [
          {
            source:
              'https://download.openstreetmap.fr/extracts/russia/central_federal_district/moscow.osm.pbf',
            timestamp: '2026-09-11T00:32:57.000Z',
          },
          {
            source:
              'https://download.openstreetmap.fr/extracts/russia/central_federal_district/moscow_oblast.osm.pbf',
            timestamp: '2026-09-11T00:31:02.000Z',
          },
        ],
        timestamp: '2026-09-11T00:32:57.000Z',
        checksum: 'md5:e2464fb23bdedb5acab88866b6cef264',
        license: 'ODbL-1.0',
      },
    },
    'saint-petersburg': {
      title: 'Санкт-Петербург',
      datasetId: 'saint-petersburg-full-20260911',
      concurrency: 8,
      plannedTiles: 6_425,
      estimatedBytes: { low: 2_600_000_000, high: 3_000_000_000 },
      boundary: {
        file: 'scripts/map-coverage/saint-petersburg.geojson',
        source:
          'https://nominatim.openstreetmap.org/lookup?format=geojson&polygon_geojson=1&polygon_threshold=0.0005&osm_ids=R337422',
        relationId: 337422,
        sha256:
          'a919c4e48eafd6183ec0224289a60ee2b8c9fabe7975fae4b97601682fbe0cfa',
        simplificationDegrees: 0.0005,
      },
      pbf: {
        file: 'saint-petersburg-with-oblast-2026-09-11.osm.pbf',
        source:
          'osmium merge: Saint Petersburg + Leningrad Oblast extracts from download.openstreetmap.fr',
        components: [
          {
            source:
              'https://download.openstreetmap.fr/extracts/russia/northwestern_federal_district/saint_petersburg.osm.pbf',
            timestamp: '2026-09-11T00:30:01.000Z',
          },
          {
            source:
              'https://download.openstreetmap.fr/extracts/russia/northwestern_federal_district/leningrad_oblast.osm.pbf',
            timestamp: '2026-09-11T00:29:02.000Z',
          },
        ],
        timestamp: '2026-09-11T00:30:01.000Z',
        checksum: 'md5:e287fb69d0f35a11573b1f57c84cc240',
        license: 'ODbL-1.0',
      },
    },
    'olonetsky-district': {
      title: 'Коридор Олонец — Ильинский (Карелия)',
      datasetId: 'olonets-ilyinsky-10km-20260911',
      concurrency: 4,
      plannedTiles: 1_994,
      estimatedBytes: { low: 350_000_000, high: 550_000_000 },
      boundary: {
        file: 'scripts/map-coverage/olonets-ilyinsky.geojson',
        source:
          '10 km buffer around the segment between OpenStreetMap relations 6360163 and 14089320',
        anchorRelationIds: [6360163, 14089320],
        sha256:
          '7e960607155e1e496f7c94e5577e507a6d6c261398c39d26f2374cb396f52308',
        bufferMeters: 10_000,
      },
      pbf: {
        file: 'karelia-republic-2026-09-11.osm.pbf',
        source:
          'https://download.openstreetmap.fr/extracts/russia/northwestern_federal_district/karelia_republic.osm.pbf',
        timestamp: '2026-09-11T00:30:01.000Z',
        checksum: 'md5:db5d6a159aa0ae4f23677c379e9bc8f9',
        license: 'ODbL-1.0',
      },
    },
  },
};
