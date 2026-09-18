export type Point = { x: number; y: number; z: number };
export type Center = { lat: number; lon: number };
export type Tags = Record<string, string>;
export type OSMElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Tags;
  members?: { type: string; ref: number; role: string }[];
};
export type ElevationGrid = {
  width: number;
  size: number;
  sizeX?: number;
  sizeZ?: number;
  values: Float32Array;
  offsetX?: number;
  offsetZ?: number;
  patches?: ElevationGrid[];
  sampleInsetX?: number;
  sampleInsetZ?: number;
  sampling?: 'ground-minimum-v1';
};
export type SourceTileData = {
  key: string;
  elements: OSMElement[];
  elevation: ElevationGrid;
  checksum?: string;
};
export type RegionData = {
  center: Center;
  elements: OSMElement[];
  elevation: ElevationGrid;
  fetchedAt: string;
  drivingSide: 'right' | 'left';
  loadedTiles?: string[];
  sourceTiles?: SourceTileData[];
  focus?: Point;
  heightDatum?: number;
};
export type RoadNode = Point & {
  id: number;
  signal: boolean;
  signalDirection?: string;
};
export type SignalApproach = {
  nodeId: number;
  edge: EdgeStableId;
  heading: number;
  axis: 0 | 1;
  width: number;
};
export type LaneProfile = {
  direction: 1 | -1;
  offsets: number[];
  turns: string[][];
  separators: { offset: number; kind: 'lane' | 'divider' }[];
  opposite: number;
  shared: boolean;
  source: 'osm' | 'estimated';
};
export type EdgeStableId = string;
// id — временный индекс текущего массива; stableId безопасно хранить между перестройками мира.
export type Edge = {
  id: number;
  stableId: EdgeStableId;
  way: number;
  from: number;
  to: number;
  length: number;
  width: number;
  lanes: number;
  combinedLanes?: number;
  laneProfile?: LaneProfile;
  markingStart?: number;
  speed: number;
  name: string;
  category?: string;
  surface?: string;
  sidewalkLeft?: boolean;
  sidewalkRight?: boolean;
  oneWay?: boolean;
  passage?: boolean;
  bridge: boolean;
  tunnel: boolean;
  tunnelApproach?: boolean;
  layer: number;
  points: Point[];
  blocked: boolean;
  blockedReasons?: ('coverage' | 'grade' | 'clearance')[];
  sourceHeightRange?: [number, number];
  clearanceIssue?: {
    otherWay: number;
    available: number;
    required: number;
    point: Point;
  };
  unloaded?: boolean;
};
export type Restriction = {
  fromWay: number;
  toWay: number;
  via: number;
  viaWays?: number[];
  only: boolean;
  kind?: string;
};
export type Building = {
  id: number;
  osmType?: 'way' | 'relation';
  sourceKey?: string;
  footprint: Point[];
  holes?: Point[][];
  height: number;
  minHeight?: number;
  supportMinHeight?: number;
  part?: boolean;
  appearance?: 'cottage';
  colour: number;
  roof: string;
  material?: string;
  facadeColour?: string;
  levels?: number;
  floorHeight?: number;
  technicalHeight?: number;
  windowPolicy?: 'procedural' | 'forbid';
  kind?: string;
  roofHeight?: number;
  roofDirection?: number;
  roofOrientation?: string;
  roofAngle?: number;
  roofLevels?: number;
  roofColour?: string;
  roofMaterial?: string;
  group?: string;
  envelopeHeight?: number;
  osmTags?: Tags;
};
export type Area = {
  id: number;
  osmType?: 'way' | 'relation';
  points: Point[];
  kind: 'water' | 'park' | 'paved';
  surface?: string;
  holes?: Point[][];
  railing?: 'river' | 'park';
};
export type Route = {
  id: string;
  kind: 'sprint' | 'circuit';
  title: string;
  edges: EdgeStableId[];
  points: Point[];
  cumulative: number[];
  length: number;
  laps: number;
};
export type RacerTraits = {
  accuracy: number;
  aggression: number;
  reaction: number;
};
export type World = {
  center: Center;
  nodes: RoadNode[];
  edges: Edge[];
  restrictions: Restriction[];
  buildings: Building[];
  areas: Area[];
  trees: Point[];
  elevation: ElevationGrid;
  drivingSide: 'right' | 'left';
  warnings: string[];
  heightDatum?: number;
  spawnEdge: EdgeStableId | null;
  routes: Route[];
  loadedTiles?: string[];
};
export type WorldPatch = {
  coverageAdded: string[];
  coverageRemoved: string[];
  nodesAddedOrUpdated: RoadNode[];
  nodesRemoved: number[];
  edgesAddedOrUpdated: Edge[];
  edgesRemoved: EdgeStableId[];
  restrictionsAddedOrUpdated: Restriction[];
  restrictionsRemoved: Restriction[];
  buildingsAddedOrUpdated: Building[];
  buildingsRemoved: { id: number; osmType: Building['osmType'] }[];
  areasAddedOrUpdated: Area[];
  areasRemoved: { id: number; osmType: Area['osmType'] }[];
  treesAdded: Point[];
  treesRemoved: Point[];
  elevationPatches: ElevationGrid[];
  elevationPatchesRemoved: string[];
  dirtyChunks: string[];
  invalidatedRoutes: string[];
};
export type PreparedWorld = { world: World; patch: WorldPatch };
export type SourceTileUpdate = {
  add: SourceTileData[];
  remove: string[];
  center: Center;
  drivingSide: RegionData['drivingSide'];
  fetchedAt: string;
  focus?: Point;
  heightDatum?: number;
  installedChunks?: string[];
  patchOnly?: boolean;
};
export type WorldPatchMeta = Pick<
  World,
  'center' | 'drivingSide' | 'heightDatum' | 'warnings' | 'spawnEdge' | 'routes'
> & { elevation: ElevationGrid };
export type PreparedPatch = { patch: WorldPatch; meta: WorldPatchMeta };
export type MeshData = {
  positions: number[];
  indices: number[];
  normals?: number[];
  colors?: number[];
  uvs?: number[];
};
export type Breakable = {
  kind: 'pole' | 'fence';
  point: Point;
  heading: number;
  length?: number;
  fenceType?: 'park' | 'embankment';
};
export type ChunkData = {
  key: string;
  lod: number;
  terrain: MeshData;
  road: MeshData;
  shoulders: MeshData;
  sidewalks?: MeshData;
  paved?: MeshData;
  landmarks?: MeshData;
  facades?: MeshData[];
  bareFacades?: MeshData[];
  markings: MeshData;
  structures: MeshData;
  treeTrunks: MeshData;
  buildings: MeshData;
  windows: MeshData;
  water: MeshData;
  trees: Point[];
  lamps: Point[];
  breakables: Breakable[];
};
export type WorkerRequest =
  | { id: number; type: 'world' | 'prepare'; region: RegionData }
  | { id: number; type: 'adopt'; world: World; sourceTiles?: SourceTileData[] }
  | { id: number; type: 'prepareTiles'; update: SourceTileUpdate }
  | { id: number; type: 'race'; start: EdgeStableId; kind: Route['kind'] }
  | { id: number; type: 'commit' }
  | {
      id: number;
      type: 'chunk';
      key: string;
      lod: number;
      cacheLimit?: number;
      prepared?: boolean;
      closeCourtyards?: boolean;
    };
export type WorkerResponse =
  | { id: number; type: 'world'; world: World }
  | { id: number; type: 'prepared'; prepared: PreparedWorld | PreparedPatch }
  | { id: number; type: 'race'; route: Route | null }
  | { id: number; type: 'committed' }
  | { id: number; type: 'chunk'; chunk: ChunkData }
  | { id: number; type: 'error'; error: string };
export type Settings = {
  quality: 'mobile' | 'low' | 'medium' | 'high';
  touchControls?: 'auto' | 'on' | 'off';
  navigator?: boolean;
  volume: number;
  traffic?: 'light' | 'city' | 'rush';
  weather?: 'dynamic' | 'clear' | 'rain' | 'overcast';
  hour?: number;
};
export type RaceState = {
  route: Route;
  phase: 'countdown' | 'running' | 'finished';
  countdown: number;
  elapsed: number;
  checkpoint: number;
  lap: number;
  position: number;
  finishTime?: number;
};
export type HUD = {
  opponents?: import('./race-map-markers').OpponentMarker[];
  speed: number;
  gear: string;
  fps: number;
  position: Point;
  heading: number;
  paused: boolean;
  loading: boolean;
  mapStatus?: string;
  race: RaceState | null;
  navigation?: NavigationHint | null;
  nearRace: Route | null;
  message: string;
  chunks: number;
  vehicles: number;
  street?: string;
  lanes?: string;
  weather?: string;
  hour?: number;
  wetness?: number;
  slip?: number;
  odometer?: number;
  nitro?: number;
  boosting?: boolean;
};
export type NavigationHint = { direction: 'left' | 'right'; distance: number };
